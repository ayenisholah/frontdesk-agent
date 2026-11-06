import { DEFAULT_RETENTION_DAYS } from "@frontdesk/core";
import type { SendResult } from "@frontdesk/channels";
import type { Db } from "./client";
import { withSlotLock, type Clock } from "./slots";
import { deliveryWork } from "./delivery-data";
import { beginDelivery, type DeliveryClaim } from "./delivery-begin";
import { resolveDelivery } from "./delivery-result";

export type DeliveryRef = { businessId: string; id: string };
export function createDeliveryStore(
  db: Db,
  businessId: string,
  clock: Clock,
  retentionDays = DEFAULT_RETENTION_DAYS,
) {
  return {
    listDead: () =>
      db.outboundWork.findMany({
        where: { businessId, state: { in: ["dead", "uncertain"] } },
        select: { businessId: true, id: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    route: (id: string) => deliveryRoute(db, businessId, id),
    defer: (id: string, delayMs: number) =>
      withSlotLock(db, businessId, clock, async (tx, now) => {
        await tx.outboundWork.updateMany({
          where: { id, businessId, state: "pending" },
          data: { nextAttemptAt: new Date(now.getTime() + delayMs) },
        });
      }),
    listDue: () => listDue(db, businessId, clock),
    begin: (id: string): Promise<DeliveryClaim> =>
      withSlotLock(db, businessId, clock, async (tx, now) => {
        const work = await deliveryWork(tx, businessId, id);
        if (!work) return { state: "skip" };
        const earlier =
          work.inboundSequence === null
            ? null
            : await tx.outboundWork.findFirst({
                where: {
                  businessId,
                  state: { in: ["pending", "sending"] },
                  recipientRole: "customer",
                  message: { conversationId: work.message.conversationId },
                  inboundSequence: { lt: work.inboundSequence },
                },
              });
        return earlier ? { state: "skip" } : beginDelivery(tx, work, now, retentionDays);
      }),
    resolve: (attemptId: string, result: SendResult) =>
      withSlotLock(db, businessId, clock, (tx, now) =>
        resolveDelivery(tx, { businessId, attemptId, now }, result),
      ),
  };
}

async function listDue(db: Db, businessId: string, clock: Clock): Promise<DeliveryRef[]> {
  const now = clock();
  const rows = await db.$queryRaw<{ id: string }[]>`
        SELECT w.id FROM "OutboundWork" w JOIN "Message" m ON m.id = w."messageId"
        WHERE w."businessId" = ${businessId}::uuid AND w.state IN ('pending', 'sending')
          AND w."nextAttemptAt" <= ${now} AND (w."leaseUntil" IS NULL OR w."leaseUntil" <= ${now})
          AND (w."recipientRole" = 'owner' OR NOT EXISTS (
            SELECT 1 FROM "OutboundWork" p JOIN "Message" pm ON pm.id = p."messageId"
            WHERE p."businessId" = ${businessId}::uuid AND p.state IN ('pending', 'sending')
              AND p."recipientRole" = 'customer' AND pm."conversationId" = m."conversationId"
              AND p."inboundSequence" < w."inboundSequence"))
        ORDER BY w."createdAt", w.id LIMIT 100`;
  return rows.map(({ id }) => ({ businessId, id }));
}

async function deliveryRoute(db: Db, businessId: string, id: string) {
  const work = await db.outboundWork.findFirst({
    where: { id, businessId, state: { in: ["pending", "sending"] } },
    include: { message: { include: { conversation: true } } },
  });
  return work
    ? {
        state: work.state,
        senderId: work.phoneNumberId,
        recipientId:
          work.recipientRole === "owner"
            ? `owner-${businessId}`
            : work.message.conversation.customerId,
      }
    : null;
}
