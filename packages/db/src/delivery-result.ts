import type { SendResult } from "@frontdesk/channels";
import type { Tx } from "./client";
import { deliveryWork, deliveryFault, type DeliveryWork } from "./delivery-data";

const delays = [1000, 5000, 30_000, 120_000];
export async function resolveDelivery(
  tx: Tx,
  context: { businessId: string; attemptId: string; now: Date },
  result: SendResult,
) {
  const { businessId, attemptId, now } = context;
  const attempt = await tx.deliveryAttempt.findFirst({
    where: { id: attemptId, outbound: { businessId } },
  });
  if (!attempt || attempt.state !== "started") return;
  const work = (await deliveryWork(tx, businessId, attempt.outboundId))!;
  if (work.attempts !== attempt.number || work.state !== "sending") return;
  await markAttempt(tx, attemptId, result, now);
  if (result.state === "accepted") {
    await acceptDelivery(tx, work, now, result.providerMessageId);
    return;
  }
  if (result.state === "retryable_rejection" && work.attempts < 5) {
    const jitter = Number.parseInt(attempt.id.slice(0, 2), 16);
    const delay = Math.max(delays[work.attempts - 1]!, result.retryAfterMs) + jitter;
    await tx.outboundWork.update({
      where: { id: work.id, businessId },
      data: { state: "pending", leaseUntil: null, nextAttemptAt: new Date(now.getTime() + delay) },
    });
    return;
  }
  const uncertain = result.state === "uncertain";
  await deliveryFault(tx, work, now, {
    state: uncertain ? "uncertain" : "dead",
    reason: uncertain ? "uncertain_delivery" : "delivery_rejected",
  });
}

async function markAttempt(tx: Tx, attemptId: string, result: SendResult, now: Date) {
  await tx.deliveryAttempt.update({
    where: { id: attemptId },
    data: {
      state: result.state,
      finishedAt: now,
      ...(result.state === "accepted" ? { providerMessageId: result.providerMessageId } : {}),
    },
  });
}

async function acceptDelivery(tx: Tx, work: DeliveryWork, now: Date, providerMessageId: string) {
  const businessId = work.businessId;
  await tx.message.update({
    where: { id: work.messageId, conversation: { businessId } },
    data: { providerMessageId: providerMessageId },
  });
  await tx.outboundWork.update({
    where: { id: work.id, businessId },
    data: { state: "accepted", finishedAt: now, leaseUntil: null },
  });
  if (work.incidentId)
    await tx.deliveryIncident.updateMany({
      where: { id: work.incidentId, businessId },
      data: { state: "notified" },
    });
}
