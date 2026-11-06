import { messagePolicy } from "@frontdesk/core";
import type { SendMessage } from "@frontdesk/channels";
import type { Tx } from "./client";
import type { WhatsAppRegistration } from "./generated/client";
import { deliveryTemplate, type DeliveryWork } from "./delivery-data";

export async function deliveryRoute(tx: Tx, work: DeliveryWork) {
  const registration = await tx.whatsAppRegistration.findFirst({
    where: { businessId: work.businessId, phoneNumberId: work.phoneNumberId },
  });
  if (!registration) return null;
  const recipient =
    work.recipientRole === "owner"
      ? registration.ownerPhone
      : work.message.conversation.customer.phone;
  if (!registration.credentialEnv || !registration.graphVersion || !recipient) return null;
  return {
    registration,
    recipient,
    sender: {
      phoneNumberId: registration.phoneNumberId,
      credentialEnv: registration.credentialEnv,
      version: registration.graphVersion,
    },
  };
}
export function deliveryContent(
  work: DeliveryWork,
  registration: WhatsAppRegistration,
  now: Date,
): SendMessage["content"] | null {
  const owner = work.recipientRole === "owner";
  const template = deliveryTemplate(registration.templates, owner);
  const conversation = work.message.conversation;
  const policy = messagePolicy({
    now,
    lastInbound: owner ? null : conversation.lastCustomerMessageAt,
    status: owner ? "agent" : conversation.status,
    allowOwner: work.allowOwner && work.ownerReason === conversation.handoffReason,
    template,
  });
  if (policy === "suppress") return null;
  if (policy === "text") return { type: "text", body: work.message.body };
  return {
    type: "template",
    name: template!.name,
    language: template!.language,
    ...(work.incidentId ? { incidentId: work.incidentId } : {}),
  };
}
