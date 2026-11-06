import { normalizePhone } from "@frontdesk/core";
import { z } from "zod";
import { whatsappChanges, whatsappTimestamp } from "./whatsapp-envelope";

const status = z.object({
  id: z.string().min(1).max(256),
  recipient_id: z.string().transform(normalizePhone).pipe(z.string()),
  timestamp: whatsappTimestamp,
  status: z.enum(["sent", "delivered", "read", "failed"]),
  biz_opaque_callback_data: z.string().max(512).optional(),
});
const update = z
  .object({
    metadata: z.object({ phone_number_id: z.string().regex(/^\d{1,32}$/) }).optional(),
    statuses: z.array(status).default([]),
  })
  .refine((v) => !v.statuses.length || Boolean(v.metadata));
export type WhatsAppStatus = {
  phoneNumberId: string;
  providerMessageId: string;
  recipient: string;
  state: "sent" | "delivered" | "read" | "failed";
  providerTimestamp: Date;
  attemptId?: string;
};
export function parseWhatsAppStatuses(payload: unknown): WhatsAppStatus[] {
  try {
    return whatsappChanges(payload).flatMap((change) => {
      const value = update.parse(change);
      return value.statuses.map((s) => ({
        phoneNumberId: value.metadata!.phone_number_id,
        providerMessageId: s.id,
        recipient: s.recipient_id,
        state: s.status,
        providerTimestamp: new Date(s.timestamp * 1000),
        ...(s.biz_opaque_callback_data ? { attemptId: s.biz_opaque_callback_data } : {}),
      }));
    });
  } catch {
    throw new Error("Invalid WhatsApp status payload");
  }
}
