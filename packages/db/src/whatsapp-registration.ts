import { z } from "zod";
import type { Db } from "./client";

const registration = z.strictObject({
  businessId: z.uuid(),
  phoneNumberId: z.string().regex(/^\d{1,32}$/),
});

/** Provisioning is explicit and idempotent; an existing number cannot change tenants. */
export async function registerWhatsAppNumber(db: Db, input: unknown) {
  const parsed = registration.safeParse(input);
  if (!parsed.success) throw new Error("Invalid registration");
  const { businessId, phoneNumberId } = parsed.data;
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-registration:${phoneNumberId}`}::text, 0))`;
    const existing = await tx.whatsAppRegistration.findUnique({ where: { phoneNumberId } });
    if (existing) {
      if (existing.businessId !== businessId) throw new Error("Number already registered");
      return;
    }
    if (!(await tx.business.findUnique({ where: { id: businessId }, select: { id: true } })))
      throw new Error("Business not found");
    await tx.whatsAppRegistration.create({ data: { businessId, phoneNumberId } });
  });
}
