import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizePhone } from "@frontdesk/core";
import { z } from "zod";
import { whatsappChanges, whatsappTimestamp } from "./whatsapp-envelope";

export interface InboundMessage {
  phoneNumberId: string;
  providerMessageId: string;
  phone: string;
  providerTimestamp: Date;
  kind: "text" | "unsupported";
  body: string;
}
export type IntakeResult = "accepted" | "duplicate" | "unregistered" | "conflict";
export type AcceptInbound = (message: InboundMessage) => Promise<IntakeResult>;

export function verifyWhatsAppSignature(
  body: Buffer,
  signature: string | undefined,
  secret: string,
) {
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}

const id = z.string().min(1).max(256);
const messageSchema = z
  .object({
    id,
    from: z.string().transform(normalizePhone).pipe(z.string()),
    timestamp: whatsappTimestamp,
    type: id,
    text: z.object({ body: z.string().min(1).max(4096) }).optional(),
  })
  .refine((m) => m.type !== "text" || m.text !== undefined);
const messagesSchema = z
  .object({
    metadata: z.object({ phone_number_id: z.string().regex(/^\d{1,32}$/) }).optional(),
    messages: z.array(messageSchema).default([]),
  })
  .refine((v) => v.messages.length === 0 || v.metadata !== undefined);

/** Strip unknown fields; never retain raw payloads or unsupported media metadata. */
export function parseWhatsAppWebhook(payload: unknown): InboundMessage[] {
  try {
    return whatsappChanges(payload).flatMap((change) => {
      const value = messagesSchema.parse(change);
      return value.messages.map((message): InboundMessage => ({
        phoneNumberId: value.metadata!.phone_number_id,
        providerMessageId: message.id,
        phone: message.from,
        providerTimestamp: new Date(message.timestamp * 1000),
        kind: message.type === "text" ? "text" : "unsupported",
        body: message.type === "text" ? message.text!.body : "[Unsupported WhatsApp message]",
      }));
    });
  } catch {
    throw new Error("Invalid WhatsApp payload");
  }
}
