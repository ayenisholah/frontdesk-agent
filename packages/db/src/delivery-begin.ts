import { retentionCutoff } from "@frontdesk/core";
import type { SendMessage } from "@frontdesk/channels";
import type { Tx } from "./client";
import { deliveryFault, recipientHash, type DeliveryWork } from "./delivery-data";
import { deliveryRoute, deliveryContent } from "./delivery-content";
export type DeliveryClaim =
  | { state: "skip" }
  | {
      state: "send";
      attemptId: string;
      message: SendMessage;
      sender: { phoneNumberId: string; credentialEnv: string; version: string };
    };
export async function beginDelivery(
  tx: Tx,
  work: DeliveryWork,
  now: Date,
  retentionDays: number,
): Promise<DeliveryClaim> {
  if (work.state === "sending") {
    if (work.leaseUntil && work.leaseUntil <= now)
      await deliveryFault(tx, work, now, { state: "uncertain", reason: "uncertain_delivery" });
    return { state: "skip" };
  }
  if (work.state !== "pending" || work.nextAttemptAt > now) return { state: "skip" };
  if (work.message.redactedAt || work.message.createdAt <= retentionCutoff(now, retentionDays)) {
    await tx.outboundWork.update({
      where: { id: work.id, businessId: work.businessId },
      data: { state: "suppressed", reason: "content_expired", finishedAt: now },
    });
    return { state: "skip" };
  }
  const route = await deliveryRoute(tx, work);
  if (!route) {
    await deliveryFault(tx, work, now, { state: "dead", reason: "sender_configuration" });
    return { state: "skip" };
  }
  const content = deliveryContent(work, route.registration, now);
  if (!content) {
    await deliveryFault(tx, work, now, { state: "suppressed", reason: "delivery_policy" });
    return { state: "skip" };
  }
  const attempt = await tx.deliveryAttempt.create({
    data: {
      outboundId: work.id,
      number: work.attempts + 1,
      recipientHash: recipientHash(route.recipient),
      startedAt: now,
    },
  });
  await tx.outboundWork.update({
    where: { id: work.id, businessId: work.businessId },
    data: {
      state: "sending",
      attempts: { increment: 1 },
      leaseUntil: new Date(now.getTime() + 30_000),
    },
  });
  return {
    state: "send",
    attemptId: attempt.id,
    sender: route.sender,
    message: { recipient: route.recipient, attemptId: attempt.id, content },
  };
}
