// ModelClient for Claude on Amazon Bedrock, through the Converse API. Authenticated by IAM,
// so there is no model API key to store. See docs/adr/0011-bedrock-region-and-agent-boundary.md.
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type ConverseCommandOutput,
  type Message,
  type Tool,
  type ToolInputSchema,
} from "@aws-sdk/client-bedrock-runtime";
import type {
  ChatMessage,
  ModelClient,
  ModelRequest,
  ModelResponse,
  ToolCall,
  ToolResult,
  ToolSpec,
} from "./model-client";
import { ModelFailure } from "./model-failure";

const REQUEST_TIMEOUT_MS = 30_000;
// Adaptive mode retries throttling and server errors only, with client-side rate limiting.
const MAX_ATTEMPTS = 3;

type ConverseSender = {
  send(
    command: ConverseCommand,
    options: { abortSignal: AbortSignal },
  ): Promise<ConverseCommandOutput>;
};

export type BedrockOptions = {
  region: string;
  /** An inference profile ID, such as an `eu.` one, so traffic stays in that geography. */
  modelId: string;
  timeoutMs?: number;
  sender?: ConverseSender;
};

function toolResultBlock({ toolCallId, content, isError }: ToolResult): ContentBlock {
  return {
    toolResult: {
      toolUseId: toolCallId,
      content: [{ text: JSON.stringify(content) }],
      status: isError ? "error" : "success",
    },
  };
}

function toolUseBlock({ id, name, input }: ToolCall): ContentBlock {
  return { toolUse: { toolUseId: id, name, input: input as never } };
}

function toConverseMessage(message: ChatMessage): Message {
  if (message.role === "user") return { role: "user", content: [{ text: message.text }] };
  if (message.role === "tool")
    return { role: "user", content: message.results.map(toolResultBlock) };
  // Converse rejects empty text blocks, and a tool-calling turn often has no text.
  const text: ContentBlock[] = message.text ? [{ text: message.text }] : [];
  return { role: "assistant", content: [...text, ...message.toolCalls.map(toolUseBlock)] };
}

function toConverseTool({ name, description, inputSchema }: ToolSpec): Tool {
  const json = inputSchema as ToolInputSchema.JsonMember["json"];
  return { toolSpec: { name, description, inputSchema: { json } } };
}

function fromConverse(output: ConverseCommandOutput): ModelResponse {
  const blocks = output.output?.message?.content ?? [];
  const toolCalls: ToolCall[] = blocks.flatMap(({ toolUse }) =>
    toolUse
      ? [{ id: toolUse.toolUseId ?? "", name: toolUse.name ?? "", input: toolUse.input }]
      : [],
  );
  return {
    text: blocks.flatMap(({ text }) => (text ? [text] : [])).join(""),
    toolCalls,
    usage: {
      inputTokens: output.usage?.inputTokens ?? 0,
      outputTokens: output.usage?.outputTokens ?? 0,
    },
  };
}

export function createBedrockClient(options: BedrockOptions): ModelClient {
  const { region, modelId, timeoutMs = REQUEST_TIMEOUT_MS } = options;
  const sender =
    options.sender ??
    new BedrockRuntimeClient({ region, maxAttempts: MAX_ATTEMPTS, retryMode: "adaptive" });
  return {
    async complete({ system, messages, tools, maxTokens, signal }: ModelRequest) {
      const command = new ConverseCommand({
        modelId,
        system: [{ text: system }],
        messages: messages.map(toConverseMessage),
        // Set explicitly: unset, it defaults to the model's maximum and reserves far more quota.
        inferenceConfig: { maxTokens },
        toolConfig: tools.length ? { tools: tools.map(toConverseTool) } : undefined,
      });
      const timeout = AbortSignal.timeout(timeoutMs);
      const abortSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let output: ConverseCommandOutput;
      try {
        output = await sender.send(command, { abortSignal });
      } catch {
        throw new ModelFailure(abortSignal.aborted ? "timeout" : "unavailable");
      }
      if (output.stopReason && !["end_turn", "tool_use"].includes(output.stopReason)) {
        throw new ModelFailure("invalid_response", fromConverse(output).usage);
      }
      return fromConverse(output);
    },
  };
}
