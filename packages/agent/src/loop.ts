// The agent loop: one customer turn in, one reply out. Limits live here in code, not the
// prompt, so nothing the model or customer says can raise them (GR-5, NFR-4).
import { recordFailureUsage } from "./model-failure";
import type { ChatMessage, ModelClient, ToolCall, ToolResult, Usage } from "./model-client";
import { runTool, toolSpecs, type Tool } from "./tools";

const MAX_TOOL_STEPS = 6;
const MAX_OUTPUT_TOKENS = 1024;
const TOKEN_BUDGET = 40_000;

export type HandoffReason = string;

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
  onUsage?: (usage: Usage) => Promise<void>;
  onStep?: (step: Step, index: number) => Promise<HandoffReason | undefined>;
};

async function runCalls<Context>(turn: Turn<Context>, calls: readonly ToolCall[], steps: Step[]) {
  for (const call of calls) {
    const started = performance.now();
    const result = await runTool(turn.tools, call, turn.context);
    const step = { call, result, latencyMs: Math.round(performance.now() - started) };
    steps.push(step);
    const terminal = await turn.onStep?.(step, steps.length - 1);
    if (terminal) return terminal;
  }
  return steps.length === MAX_TOOL_STEPS ? "step_cap" : undefined;
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
    let response;
    try {
      response = await model.complete({
        system,
        messages,
        tools: specs,
        maxTokens: MAX_OUTPUT_TOKENS,
      });
    } catch (error) {
      await recordFailureUsage(error, async (reported) => {
        await turn.onUsage?.(reported);
        usage.inputTokens += reported.inputTokens;
        usage.outputTokens += reported.outputTokens;
      });
      return stop("model_error");
    }
    await turn.onUsage?.(response.usage);
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;

    if (usage.inputTokens + usage.outputTokens >= tokenBudget) return stop("token_budget");
    if (response.toolCalls.length === 0) {
      const reply = response.text.trim();
      return reply ? { reply, steps, usage } : stop("empty_reply");
    }
    if (steps.length + response.toolCalls.length > MAX_TOOL_STEPS) return stop("step_cap");

    const previous = steps.length;
    const terminal = await runCalls(turn, response.toolCalls, steps);
    if (terminal) return stop(terminal);
    const ran = steps.slice(previous);
    messages.push(
      { role: "assistant", text: response.text, toolCalls: response.toolCalls },
      { role: "tool", results: ran.map((step) => step.result) },
    );
  }
}
