import { z } from "zod";
import type { AgentConfig } from "./config";
import type { AgentStore } from "./agent-store";
import type { HandoffReason, Step } from "./loop";
import type { Usage } from "./model-client";

const output = z.object({
  reply: z.string(),
  failed: z.boolean().optional(),
  handoff: z.string().optional(),
});
export function trustedOutput(step: Step) {
  const parsed = output.safeParse(step.result.content);
  return parsed.success ? parsed.data : undefined;
}
export function usageRecorder(store: AgentStore, runId: string, config: AgentConfig) {
  return async (modelId: string, usage: Usage) => {
    const rate = config.rates.models[modelId]!;
    const costMicros = Math.ceil(
      usage.inputTokens * rate.inputMicrosPerToken + usage.outputTokens * rate.outputMicrosPerToken,
    );
    await store.recordUsage(runId, {
      modelId,
      usage,
      costMicros,
      ratesVersion: config.rates.version,
    });
  };
}
export function stepRecorder(store: AgentStore, runId: string) {
  return async (step: Step, index: number): Promise<HandoffReason | undefined> => {
    await store.recordStep(runId, index + 1, step);
    const value = trustedOutput(step);
    if (value?.handoff) return value.handoff;
    const failed = step.result.isError || value?.failed === true;
    const count = await store.taskFailure(runId, step.call.name, failed);
    return count >= 3 ? "repeated_failure" : undefined;
  };
}
const clarifications: Record<string, string> = {
  service: "Which service would you like?",
  date: "Which date would you prefer?",
  time: "Which of the offered times would you prefer?",
  confirm: "Would you like me to hold that time?",
  welcome: "Hello! How can I help with an appointment?",
};
export function safeReply(steps: Step[], text: string): string | undefined {
  const last = steps.at(-1);
  if (last) return trustedOutput(last)?.reply;
  try {
    const parsed = z
      .strictObject({ clarification: z.enum(["service", "date", "time", "confirm", "welcome"]) })
      .parse(JSON.parse(text) as unknown);
    return clarifications[parsed.clarification];
  } catch {
    return undefined;
  }
}
