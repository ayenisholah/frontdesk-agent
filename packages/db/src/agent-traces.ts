import type { RunFinish, Step, UsageRecord } from "@frontdesk/agent";
import { Prisma } from "./generated/client";
import { queueReply } from "./worker-reply";
import type { Tx } from "./client";
import { scopedConversation, type AgentScope } from "./agent-scope";

function json(value: unknown) {
  if (value === null) return Prisma.JsonNull;
  if (value === undefined) return {};
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
export async function recordStep(tx: Tx, runId: string, index: number, step: Step): Promise<void> {
  await tx.agentStep.create({
    data: {
      runId,
      index,
      tool: step.call.name,
      input: json(step.call.input),
      output: json(step.result.content),
      error: step.result.isError ? "tool_failed" : null,
      latencyMs: step.latencyMs,
    },
  });
}
export async function recordUsage(tx: Tx, runId: string, record: UsageRecord): Promise<void> {
  const { usage, modelId, costMicros, ratesVersion } = record;
  await tx.agentUsage.create({ data: { runId, modelId, ...usage, costMicros, ratesVersion } });
  await tx.agentRun.update({
    where: { id: runId },
    data: {
      inputTokens: { increment: usage.inputTokens },
      outputTokens: { increment: usage.outputTokens },
      costMicros: { increment: costMicros },
    },
  });
}
export async function finishRun(
  tx: Tx,
  context: { scope: AgentScope; now: Date; runId: string },
  result: RunFinish,
): Promise<void> {
  const { scope, runId, now } = context;
  const conversation = await scopedConversation(tx, scope);
  if (conversation.status !== "agent") {
    if (!result.handoff) throw new Error("Conversation ownership changed");
    const ownHandoff = await tx.toolExecution.findFirst({
      where: { runId, signature: JSON.stringify(["handoff", result.handoff]) },
    });
    if (!ownHandoff) throw new Error("Conversation ownership changed");
  }
  await tx.agentRun.update({
    where: { id: runId },
    data: {
      reply: result.reply,
      outcome: result.outcome,
      latencyMs: result.latencyMs,
      finishedAt: now,
    },
  });
  const message = await tx.message.create({
    data: {
      conversationId: scope.conversationId,
      channel: conversation.channel,
      direction: "outbound",
      author: "agent",
      body: result.reply,
      createdAt: now,
    },
  });
  if (scope.lease)
    await queueReply(tx, scope, now, {
      messageId: message.id,
      allowOwner: Boolean(result.handoff),
    });
}
export async function taskFailure(
  tx: Tx,
  conversationId: string,
  task: string,
  failed: boolean,
): Promise<number> {
  if (!failed) {
    await tx.agentTaskFailure.deleteMany({ where: { conversationId, task } });
    return 0;
  }
  const row = await tx.agentTaskFailure.upsert({
    where: { conversationId_task: { conversationId, task } },
    create: { conversationId, task },
    update: { count: { increment: 1 } },
  });
  return row.count;
}
