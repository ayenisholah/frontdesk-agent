import { z } from "zod";
import type { WhatsAppStatus } from "@frontdesk/channels";
import type { Db, Tx } from "./client";
import { withSlotLock, type Clock } from "./slots";
import { deliveryFault, deliveryWork, recipientHash } from "./delivery-data";

const rank: Record<string, number> = { accepted: 1, sent: 2, delivered: 3, read: 4 };
/** Only the signature-verified webhook calls this adapter. Unknown correlations do nothing. */
export function createWhatsAppStatusIntake(db: Db, clock: Clock) {
  return async (status: WhatsAppStatus) => {
    const registration = await db.whatsAppRegistration.findUnique({
      where: { phoneNumberId: status.phoneNumberId },
    });
    if (!registration) return "ignored" as const;
    return withSlotLock(db, registration.businessId, clock, (tx, now) =>
      reconcile(tx, registration.businessId, { status, now }),
    );
  };
}
async function reconcile(
  tx: Tx,
  businessId: string,
  { status, now }: { status: WhatsAppStatus; now: Date },
) {
  const attempt = await findAttempt(tx, businessId, status);
  if (!attempt) return "ignored" as const;
  const work = (await deliveryWork(tx, businessId, attempt.outboundId))!;
  if (staleStatus(work.state, attempt.lastStatusAt, status)) return "matched" as const;
  await tx.deliveryAttempt.update({
    where: { id: attempt.id },
    data: {
      providerMessageId: status.providerMessageId,
      state: status.state,
      lastStatusAt: status.providerTimestamp,
      finishedAt: now,
    },
  });
  if (status.state === "failed") {
    await deliveryFault(tx, work, now, { state: "dead", reason: "delivery_failed" });
    return "matched" as const;
  }
  await tx.message.update({
    where: { id: work.messageId, conversation: { businessId } },
    data: { providerMessageId: status.providerMessageId },
  });
  await tx.outboundWork.update({
    where: { id: work.id, businessId },
    data: { state: status.state, leaseUntil: null, finishedAt: now },
  });
  if (work.incidentId)
    await tx.deliveryIncident.updateMany({
      where: { id: work.incidentId, businessId },
      data: { state: "notified" },
    });
  return "matched" as const;
}

async function findAttempt(tx: Tx, businessId: string, status: WhatsAppStatus) {
  const callback = z.uuid().safeParse(status.attemptId);
  return tx.deliveryAttempt.findFirst({
    where: {
      outbound: { businessId, phoneNumberId: status.phoneNumberId },
      recipientHash: recipientHash(status.recipient),
      OR: [
        { providerMessageId: status.providerMessageId },
        ...(callback.success
          ? [
              {
                id: callback.data,
                OR: [{ providerMessageId: null }, { providerMessageId: status.providerMessageId }],
              },
            ]
          : []),
      ],
    },
  });
}

function staleStatus(state: string, lastStatusAt: Date | null, status: WhatsAppStatus) {
  const current = rank[state] ?? 0;
  if (current >= 3 && (rank[status.state] ?? 0) <= current) return true;
  return (
    status.state !== "delivered" &&
    status.state !== "read" &&
    Boolean(lastStatusAt && status.providerTimestamp < lastStatusAt)
  );
}
