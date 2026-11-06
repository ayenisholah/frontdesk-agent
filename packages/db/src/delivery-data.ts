import { createHash } from "node:crypto";
import { z } from "zod";
import type { Tx } from "./client";
import type { Prisma } from "./generated/client";

export type DeliveryWork = Prisma.OutboundWorkGetPayload<{
  include: { message: { include: { conversation: { include: { customer: true } } } } };
}>;
export async function deliveryWork(tx: Tx, businessId: string, id: string) {
  return tx.outboundWork.findFirst({
    where: { id, businessId },
    include: { message: { include: { conversation: { include: { customer: true } } } } },
  });
}
const template = z.object({
  name: z.string().regex(/^[a-z0-9_]+$/),
  language: z.string().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/),
  verifiedAt: z.iso.datetime(),
});
const templates = z.object({ customer: template.optional(), owner: template.optional() });
export function deliveryTemplate(value: unknown, owner: boolean) {
  const parsed = templates.safeParse(value);
  if (!parsed.success) return null;
  const selected = owner ? parsed.data.owner : parsed.data.customer;
  return selected ? { ...selected, verifiedAt: new Date(selected.verifiedAt) } : null;
}
export const recipientHash = (phone: string) => createHash("sha256").update(phone).digest("hex");

/** An alert failure is visible in the incident ledger and never creates another alert. */
export async function deliveryFault(
  tx: Tx,
  work: DeliveryWork,
  now: Date,
  failure: { state: "dead" | "uncertain" | "suppressed"; reason: string },
) {
  await tx.outboundWork.update({
    where: { id: work.id, businessId: work.businessId },
    data: { ...failure, finishedAt: now, leaseUntil: null },
  });
  if (work.incidentId) {
    await tx.deliveryIncident.updateMany({
      where: { id: work.incidentId, businessId: work.businessId },
      data: { state: "failed" },
    });
    return;
  }
  const conversationId = work.message.conversationId;
  await tx.conversation.updateMany({
    where: { id: conversationId, businessId: work.businessId, status: "agent" },
    data: { status: "owner", handoffReason: failure.reason },
  });
  const prior = await tx.deliveryIncident.findFirst({
    where: { businessId: work.businessId, outboundId: work.id },
  });
  if (prior) return;
  const incident = await tx.deliveryIncident.create({
    data: {
      businessId: work.businessId,
      conversationId,
      outboundId: work.id,
      reason: failure.reason,
      createdAt: now,
    },
  });
  const message = await tx.message.create({
    data: {
      conversationId,
      channel: "whatsapp",
      direction: "outbound",
      author: "system",
      body: incident.id,
      createdAt: now,
    },
  });
  await tx.outboundWork.create({
    data: {
      businessId: work.businessId,
      messageId: message.id,
      phoneNumberId: work.phoneNumberId,
      recipientRole: "owner",
      incidentId: incident.id,
      createdAt: now,
      nextAttemptAt: now,
    },
  });
}
