import { z } from "zod";

export const whatsappTimestamp = z
  .string()
  .regex(/^\d{1,12}$/)
  .transform(Number)
  .refine((n) => n <= 253402300799);
const envelope = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(
    z.object({ changes: z.array(z.object({ field: z.string(), value: z.unknown() })) }),
  ),
});
export function whatsappChanges(payload: unknown): unknown[] {
  return envelope
    .parse(payload)
    .entry.flatMap((entry) =>
      entry.changes.filter((change) => change.field === "messages").map((change) => change.value),
    );
}
