import type { AgentConfig } from "./config";
import type { AgentStore, ConversationSnapshot, RunFinish } from "./agent-store";
import type { ModelClient } from "./model-client";
import { ModelFailure } from "./model-failure";
import { createBusinessTools, HANDOFF_REPLY } from "./business-tools";
import { classify, parseClassification } from "./classification";
import { safeReply, stepRecorder, trustedOutput, usageRecorder } from "./conversation-hooks";
import { runTurn } from "./loop";
import { PROMPT_VERSION, systemPrompt } from "./prompt";

export type ConversationOptions = {
  store: AgentStore;
  model: ModelClient;
  classifier: ModelClient;
  config: AgentConfig;
  clock: () => Date;
};
export type ConversationResult = {
  state: "replied" | "replay" | "silent" | "busy";
  reply?: string;
  handoff?: string;
};
type ExecutionResult = Omit<RunFinish, "latencyMs"> & { persistedHandoff?: boolean };
const handoff = (reason: string): Omit<RunFinish, "latencyMs"> => ({
  reply: HANDOFF_REPLY,
  outcome:
    reason === "token_budget" ? "budget_exceeded" : reason === "model_error" ? "error" : "handoff",
  handoff: reason,
});

async function execute(
  options: ConversationOptions,
  runId: string,
  snapshot: ConversationSnapshot,
): Promise<ExecutionResult> {
  const { store, config, classifier, model, clock } = options;
  const record = usageRecorder(store, runId, config);
  const classificationStarted = clock().getTime();
  const response = await classify(classifier, snapshot.messages);
  await record(config.smallModelId, response.usage);
  const budget = 40_000 - response.usage.inputTokens - response.usage.outputTokens;
  await store.recordStep(runId, 0, {
    call: { id: "classification", name: "classify", input: { modelId: config.smallModelId } },
    result: { toolCallId: "classification", content: { text: response.text }, isError: false },
    latencyMs: Math.max(0, clock().getTime() - classificationStarted),
  });
  if (budget <= 0) return handoff("token_budget");
  const decision = parseClassification(response);
  if (decision.category !== "routine") return handoff(decision.category);
  if (decision.language === "other")
    return {
      reply: "I can help in English. Would you like me to ask the owner to help?",
      outcome: "replied",
    };
  const result = await runTurn({
    model,
    system: systemPrompt(snapshot, clock()),
    messages: snapshot.messages,
    tools: createBusinessTools(),
    context: { store, config: snapshot.config, runId, now: clock },
    handoffReply: HANDOFF_REPLY,
    tokenBudget: budget,
    onUsage: (usage) => record(config.modelId, usage),
    onStep: stepRecorder(store, runId),
  });
  if (result.handoff)
    return {
      ...handoff(result.handoff),
      persistedHandoff: result.steps.some((s) => trustedOutput(s)?.handoff === result.handoff),
    };
  const reply = safeReply(result.steps, result.reply);
  return reply ? { reply, outcome: "replied" } : handoff("unknown_question");
}

export async function runConversationTurn(
  options: ConversationOptions,
  messageId: string,
): Promise<ConversationResult> {
  const { store, config, clock } = options;
  const claim = await store.claim(messageId, {
    model: config.modelId,
    promptVersion: PROMPT_VERSION,
    ratesVersion: config.rates.version,
  });
  if (claim.state !== "claimed") return claim;
  const started = clock().getTime();
  let result: ExecutionResult;
  try {
    result = await execute(options, claim.runId, claim.snapshot);
  } catch (error) {
    if (!(error instanceof ModelFailure)) throw error;
    result = { ...handoff("model_error"), outcome: "error" };
  }
  if (result.handoff && !result.persistedHandoff)
    await store.handoff(claim.runId, "system-handoff", result.handoff);
  await store.finish(claim.runId, {
    ...result,
    latencyMs: Math.max(0, clock().getTime() - started),
  });
  return {
    state: "replied",
    reply: result.reply,
    ...(result.handoff ? { handoff: result.handoff } : {}),
  };
}
