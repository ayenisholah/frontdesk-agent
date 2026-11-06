import { z } from "zod";
import type { Db, Tx } from "./client";
import { withSlotLock, type Clock } from "./slots";
const resolution = z.discriminatedUnion("state", [
  z.object({ state: z.literal("accepted"), providerMessageId: z.string().min(1).max(256) }),
  z.object({ state: z.literal("dead") }),
]);
export function createDeliveryOperator(db: Db, businessId: string, clock: Clock) {
  return {
    async inspect() {
      const outbound = await db.outboundWork.findMany({
        where: { businessId, state: { in: ["dead", "uncertain", "suppressed"] } },
        select: { id: true, state: true, reason: true, attempts: true, finishedAt: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      const incidents = await db.deliveryIncident.findMany({
        where: { businessId },
        select: { id: true, outboundId: true, state: true, reason: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return { outbound, incidents };
    },
    resolve: (id: string, input: unknown) =>
      withSlotLock(db, businessId, clock, async (tx, now) => {
        const parsed = resolution.safeParse(input);
        if (!z.uuid().safeParse(id).success || !parsed.success)
          throw new Error("Invalid delivery resolution");
        const work = await tx.outboundWork.findFirst({
          where: { id, businessId, state: "uncertain" },
        });
        if (!work) throw new Error("Uncertain delivery unavailable");
        const result = parsed.data;
        if (result.state === "accepted")
          await tx.message.update({
            where: { id: work.messageId, conversation: { businessId } },
            data: { providerMessageId: result.providerMessageId },
          });
        await tx.outboundWork.update({
          where: { id, businessId },
          data: {
            state: result.state,
            reason: "operator_resolution",
            finishedAt: now,
            leaseUntil: null,
          },
        });
        await tx.deliveryAttempt.updateMany({
          where: { outboundId: id, number: work.attempts, outbound: { businessId } },
          data: {
            state: `operator_${result.state}`,
            finishedAt: now,
            ...(result.state === "accepted" ? { providerMessageId: result.providerMessageId } : {}),
          },
        });
        await resolveIncident(
          tx,
          { businessId, id, incidentId: work.incidentId, state: result.state },
          now,
        );
      }),
  };
}

async function resolveIncident(
  tx: Tx,
  context: { businessId: string; id: string; incidentId: string | null; state: string },
  now: Date,
) {
  const { businessId, id, incidentId, state } = context;
  if (incidentId)
    await tx.deliveryIncident.updateMany({
      where: { businessId, id: incidentId },
      data: { state: state === "accepted" ? "notified" : "failed" },
    });
  const incident = await tx.deliveryIncident.findFirst({
    where: { businessId, outboundId: id },
  });
  if (incident) {
    await tx.deliveryIncident.update({
      where: { id: incident.id, businessId },
      data: { state: "resolved" },
    });
    await tx.outboundWork.updateMany({
      where: { businessId, incidentId: incident.id, state: "pending" },
      data: { state: "suppressed", reason: "incident_resolved", finishedAt: now },
    });
  }
}
