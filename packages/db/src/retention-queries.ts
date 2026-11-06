import type { Tx } from "./client";
import { Prisma } from "./generated/client";

export async function retentionCandidates(
  tx: Tx,
  scope: { businessId: string; now: Date; cutoff: Date; batchSize: number },
) {
  const { businessId, now, cutoff, batchSize } = scope;
  // A bounded active turn or send may still hold content in memory. Redact after it relinquishes its lease.
  const idle = Prisma.sql`
    NOT EXISTS (SELECT 1 FROM "InboundWork" w JOIN "Message" im ON im.id = w."messageId"
      WHERE w."businessId" = ${businessId}::uuid AND im."conversationId" = c.id
        AND w.state = 'processing' AND w."leaseUntil" > ${now})
    AND NOT EXISTS (SELECT 1 FROM "OutboundWork" w JOIN "Message" om ON om.id = w."messageId"
      WHERE w."businessId" = ${businessId}::uuid AND om."conversationId" = c.id
        AND w.state = 'sending' AND w."leaseUntil" > ${now})
    AND NOT EXISTS (SELECT 1 FROM "AgentRun" live WHERE live."conversationId" = c.id
      AND live."finishedAt" IS NULL AND live."startedAt" > ${new Date(now.getTime() - 300_000)})`;
  const messages = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT m.id FROM "Message" m JOIN "Conversation" c ON c.id = m."conversationId"
    WHERE c."businessId" = ${businessId}::uuid AND m."createdAt" <= ${cutoff}
      AND m."redactedAt" IS NULL AND ${idle} ORDER BY m."createdAt", m.id LIMIT ${batchSize}`);
  const runs = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT r.id FROM "AgentRun" r JOIN "Conversation" c ON c.id = r."conversationId"
    WHERE c."businessId" = ${businessId}::uuid AND r."startedAt" <= ${cutoff}
      AND r."redactedAt" IS NULL AND ${idle} ORDER BY r."startedAt", r.id LIMIT ${batchSize}`);
  return { messages: messages.map((r) => r.id), runs: runs.map((r) => r.id) };
}
