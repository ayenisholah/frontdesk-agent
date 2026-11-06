import { z } from "zod";
import { DEFAULT_RETENTION_DAYS, retentionCutoff } from "@frontdesk/core";
import type { Db, Tx } from "./client";
import { Prisma } from "./generated/client";
import { withSlotLock, type Clock } from "./slots";
import { retentionCandidates } from "./retention-queries";
import { deliveryWork, deliveryFault } from "./delivery-data";
const settings = z.object({
  days: z.number().int().min(1).max(3650).default(DEFAULT_RETENTION_DAYS),
  batchSize: z.number().int().min(1).max(1000).default(100),
});
export async function redactBusinessContent(
  db: Db,
  businessId: string,
  options: { clock: Clock; days?: number; batchSize?: number },
) {
  const parsed = settings.safeParse(options);
  if (!parsed.success) throw new Error("Invalid retention configuration");
  return withSlotLock(db, businessId, options.clock, async (tx, now) => {
    const { days, batchSize } = parsed.data;
    const rows = await retentionCandidates(tx, {
      businessId,
      now,
      cutoff: retentionCutoff(now, days),
      batchSize,
    });
    await redactMessages(tx, businessId, rows.messages, now);
    await redactRuns(tx, businessId, rows.runs, now);
    return { messages: rows.messages.length, runs: rows.runs.length };
  });
}
async function redactMessages(tx: Tx, businessId: string, ids: string[], now: Date) {
  await tx.message.updateMany({
    where: { id: { in: ids }, conversation: { businessId } },
    data: { body: "[redacted]", redactedAt: now },
  });
  await tx.inboundWork.updateMany({
    where: { businessId, messageId: { in: ids }, state: { in: ["pending", "processing"] } },
    data: {
      state: "skipped",
      reason: "content_expired",
      finishedAt: now,
      leaseUntil: null,
      leaseToken: { increment: 1 },
    },
  });
  await tx.outboundWork.updateMany({
    where: { businessId, messageId: { in: ids }, state: "pending" },
    data: { state: "suppressed", reason: "content_expired", finishedAt: now },
  });
  const sending = await tx.outboundWork.findMany({
    where: { businessId, messageId: { in: ids }, state: "sending" },
    select: { id: true },
  });
  for (const row of sending) {
    const work = (await deliveryWork(tx, businessId, row.id))!;
    await deliveryFault(tx, work, now, { state: "uncertain", reason: "content_expired" });
  }
}
async function redactRuns(tx: Tx, businessId: string, ids: string[], now: Date) {
  const where = { id: { in: ids }, conversation: { businessId } };
  const interrupted = await tx.agentRun.findMany({
    where: { ...where, finishedAt: null },
    select: { conversationId: true },
  });
  await tx.conversation.updateMany({
    where: { businessId, id: { in: interrupted.map((r) => r.conversationId) }, status: "agent" },
    data: { status: "owner", handoffReason: "content_expired" },
  });
  await tx.agentRun.updateMany({
    where: { ...where, finishedAt: null },
    data: { finishedAt: now, outcome: "error" },
  });
  await tx.agentRun.updateMany({ where, data: { reply: null, redactedAt: now } });
  const run = { conversation: { businessId } };
  await tx.agentStep.updateMany({
    where: { runId: { in: ids }, run },
    data: { input: Prisma.JsonNull, output: Prisma.JsonNull },
  });
  await tx.toolExecution.updateMany({
    where: { runId: { in: ids }, run },
    data: { signature: "[redacted]", result: Prisma.JsonNull },
  });
}
