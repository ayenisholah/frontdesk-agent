// The agent loop: one customer turn in, one reply out. Limits live here in code, not the
// prompt, so nothing the model or customer says can raise them (GR-5, NFR-4).
import type { ChatMessage, ModelClient, ToolCall, ToolResult, Usage } from "./model-client";
import { runTool, toolSpecs, type Tool } from "./tools";

const MAX_TOOL_STEPS = 6;
const MAX_OUTPUT_TOKENS = 1024;
const TOKEN_BUDGET = 40_000;

export type HandoffReason = "step_cap" | "token_budget" | "empty_reply";

export type Step = { call: ToolCall; result: ToolResult; latencyMs: number };

export type TurnResult = {
  reply: string;
  steps: Step[];
  usage: Usage;
  /** Set when the loop stopped and the owner has to take over. */
  handoff?: HandoffReason;
};

export type Turn<Context> = {
  model: ModelClient;
  system: string;
  /** The conversation so far, ending with the customer's new message. */
  messages: readonly ChatMessage[];
  tools: readonly Tool<Context>[];
  context: Context;
  /** The fixed wording sent when the loop hands off. */
  handoffReply: string;
  tokenBudget?: number;
};

async function runCalls<Context>(turn: Turn<Context>, calls: readonly ToolCall[]): Promise<Step[]> {
  const steps: Step[] = [];
  for (const call of calls) {
    const started = performance.now();
    const result = await runTool(turn.tools, call, turn.context);
    steps.push({ call, result, latencyMs: Math.round(performance.now() - started) });
  }
  return steps;
}

/** Runs the model and its tools until it replies or a limit stops it. */
export async function runTurn<Context>(turn: Turn<Context>): Promise<TurnResult> {
  const { model, system, tools, handoffReply, tokenBudget = TOKEN_BUDGET } = turn;
  const messages = [...turn.messages];
  const specs = toolSpecs(tools);
  const steps: Step[] = [];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const stop = (handoff: HandoffReason): TurnResult => ({
    reply: handoffReply,
    steps,
    usage,
    handoff,
  });

  for (;;) {
    const response = await model.complete({
      system,
      messages,
      tools: specs,
      maxTokens: MAX_OUTPUT_TOKENS,
    });
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;

    if (usage.inputTokens + usage.outputTokens > tokenBudget) return stop("token_budget");
    if (response.toolCalls.length === 0) {
      const reply = response.text.trim();
      return reply ? { reply, steps, usage } : stop("empty_reply");
    }
    if (steps.length + response.toolCalls.length > MAX_TOOL_STEPS) return stop("step_cap");

    const ran = await runCalls(turn, response.toolCalls);
    steps.push(...ran);
    messages.push(
      { role: "assistant", text: response.text, toolCalls: response.toolCalls },
      { role: "tool", results: ran.map((step) => step.result) },
    );
  }
}
