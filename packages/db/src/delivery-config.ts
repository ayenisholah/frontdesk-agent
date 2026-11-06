import { normalizePhone } from "@frontdesk/core";
import { z } from "zod";
import type { Db } from "./client";
const template = z.object({
  name: z.string().regex(/^[a-z0-9_]+$/),
  language: z.string().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/),
  verifiedAt: z.iso.datetime(),
});
const config = z.strictObject({
  businessId: z.uuid(),
  phoneNumberId: z.string().regex(/^\d{1,32}$/),
  credentialEnv: z.string().regex(/^WHATSAPP_[A-Z0-9_]+_TOKEN$/),
  graphVersion: z.string().regex(/^v\d+\.\d+$/),
  ownerPhone: z.string().transform(normalizePhone).pipe(z.string()),
  templates: z.object({ owner: template, customer: template.optional() }),
});
/** Called by provisioning only after Meta verifies the selected template approvals. */
export async function configureWhatsAppDelivery(db: Db, input: unknown) {
  const parsed = config.safeParse(input);
  if (!parsed.success) throw new Error("Invalid delivery configuration");
  const { businessId, phoneNumberId, ...data } = parsed.data;
  const result = await db.whatsAppRegistration.updateMany({
    where: { businessId, phoneNumberId },
    data,
  });
  if (!result.count) throw new Error("Sender registration unavailable");
}
