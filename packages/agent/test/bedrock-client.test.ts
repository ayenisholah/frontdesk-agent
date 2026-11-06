import type { ConverseCommand, ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it, vi } from "vitest";
import { createBedrockClient, type ChatMessage, type ModelRequest } from "../src/index";

const MODEL = "eu.anthropic.example";

function stub(output: Partial<ConverseCommandOutput> = {}) {
  const send = vi.fn(async (_command: ConverseCommand, _options: { abortSignal: AbortSignal }) => {
    return output as ConverseCommandOutput;
  });
  return {
    send,
    client: createBedrockClient({ region: "eu-west-1", modelId: MODEL, sender: { send } }),
  };
}

const request = (messages: ChatMessage[], over: Partial<ModelRequest> = {}): ModelRequest => ({
  system: "You are a front desk.",
  messages,
  tools: [],
  maxTokens: 512,
  ...over,
});

const sent = (send: ReturnType<typeof stub>["send"]) => send.mock.calls[0]![0].input;

describe("createBedrockClient request", () => {
  it("sends the model, system prompt and an explicit token limit", async () => {
    const { client, send } = stub();
    await client.complete(request([{ role: "user", text: "Hi" }]));
    expect(sent(send)).toMatchObject({
      modelId: MODEL,
      system: [{ text: "You are a front desk." }],
      messages: [{ role: "user", content: [{ text: "Hi" }] }],
      inferenceConfig: { maxTokens: 512 },
    });
  });

  it("leaves tool config out when there are no tools", async () => {
    const { client, send } = stub();
    await client.complete(request([{ role: "user", text: "Hi" }]));
    expect(sent(send).toolConfig).toBeUndefined();
  });

  it("maps tool specs", async () => {
    const { client, send } = stub();
    const inputSchema = { type: "object", properties: {} };
    const tools = [{ name: "get_services", description: "Lists services.", inputSchema }];
    await client.complete(request([{ role: "user", text: "Hi" }], { tools }));
    expect(sent(send).toolConfig).toEqual({
      tools: [
        {
          toolSpec: {
            name: "get_services",
            description: "Lists services.",
            inputSchema: { json: inputSchema },
          },
        },
      ],
    });
  });

  it("maps a tool round trip", async () => {
    const { client, send } = stub();
    const toolCalls = [{ id: "t1", name: "get_services", input: { a: 1 } }];
    await client.complete(
      request([
        { role: "user", text: "Hi" },
        { role: "assistant", text: "Checking", toolCalls },
        { role: "tool", results: [{ toolCallId: "t1", content: { ok: true }, isError: false }] },
      ]),
    );
    expect(sent(send).messages?.slice(1)).toEqual([
      {
        role: "assistant",
        content: [
          { text: "Checking" },
          { toolUse: { toolUseId: "t1", name: "get_services", input: { a: 1 } } },
        ],
      },
      {
        role: "user",
        content: [
          {
            toolResult: { toolUseId: "t1", content: [{ text: '{"ok":true}' }], status: "success" },
          },
        ],
      },
    ]);
  });

  it("omits empty assistant text, which Converse rejects", async () => {
    const { client, send } = stub();
    const toolCalls = [{ id: "t1", name: "x", input: {} }];
    await client.complete(request([{ role: "assistant", text: "", toolCalls }]));
    expect(sent(send).messages?.[0]?.content).toEqual([
      { toolUse: { toolUseId: "t1", name: "x", input: {} } },
    ]);
  });

  it("marks failed tool results", async () => {
    const { client, send } = stub();
    const results = [{ toolCallId: "t1", content: { error: "no" }, isError: true }];
    await client.complete(request([{ role: "tool", results }]));
    expect(sent(send).messages?.[0]?.content?.[0]?.toolResult?.status).toBe("error");
  });

  it("gives every request a timeout", async () => {
    const { client, send } = stub();
    await client.complete(request([{ role: "user", text: "Hi" }]));
    expect(send.mock.calls[0]![1].abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("aborts when the timeout passes", async () => {
    const send = vi.fn(
      (_command: ConverseCommand, { abortSignal }: { abortSignal: AbortSignal }) =>
        new Promise<ConverseCommandOutput>((_, reject) => {
          abortSignal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const client = createBedrockClient({
      region: "eu-west-1",
      modelId: MODEL,
      sender: { send },
      timeoutMs: 1,
    });
    await expect(client.complete(request([{ role: "user", text: "Hi" }]))).rejects.toThrow(
      "Model timeout",
    );
  });
});

describe("createBedrockClient response", () => {
  const reply = (over: Partial<ConverseCommandOutput>) =>
    stub(over).client.complete(request([{ role: "user", text: "Hi" }]));

  it("reads text and usage", async () => {
    const result = await reply({
      output: { message: { role: "assistant", content: [{ text: "Hello " }, { text: "there" }] } },
      usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
    });
    expect(result).toEqual({
      text: "Hello there",
      toolCalls: [],
      usage: { inputTokens: 12, outputTokens: 3 },
    });
  });

  it("reads tool calls", async () => {
    const toolUse = { toolUseId: "t1", name: "get_services", input: { a: 1 } };
    const result = await reply({
      output: { message: { role: "assistant", content: [{ text: "Checking" }, { toolUse }] } },
    });
    expect(result.toolCalls).toEqual([{ id: "t1", name: "get_services", input: { a: 1 } }]);
  });

  it("treats incomplete tool calls as ones the loop will refuse", async () => {
    const result = await reply({
      output: { message: { role: "assistant", content: [{ toolUse: {} as never }] } },
    });
    expect(result.toolCalls[0]).toMatchObject({ id: "", name: "" });
  });

  it("copes with an empty response", async () => {
    expect(await reply({})).toEqual({
      text: "",
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });

  it("copes with missing usage fields", async () => {
    const result = await reply({ usage: {} as never });
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe("default sender", () => {
  it("builds a real client without calling AWS", () => {
    const client = createBedrockClient({ region: "eu-west-1", modelId: MODEL });
    expect(client.complete).toBeTypeOf("function");
  });
});

it("sanitizes provider errors and refuses truncated responses", async () => {
  const send = vi.fn().mockRejectedValue(new Error("secret provider payload"));
  const client = createBedrockClient({ region: "eu-west-1", modelId: MODEL, sender: { send } });
  await expect(client.complete(request([]))).rejects.toThrow("Model unavailable");
  const truncated = stub({ stopReason: "max_tokens" }).client;
  await expect(truncated.complete(request([]))).rejects.toThrow("Model invalid_response");
  await expect(
    stub({ stopReason: "end_turn" }).client.complete(request([])),
  ).resolves.toBeDefined();
});

it("preserves reported usage when rejecting a truncated completion", async () => {
  const { client } = stub({
    stopReason: "max_tokens",
    usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
  });
  await expect(client.complete(request([]))).rejects.toMatchObject({
    code: "invalid_response",
    usage: { inputTokens: 20, outputTokens: 10 },
  });
});
