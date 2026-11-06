import { expect, it } from "vitest";
import { parseWhatsAppStatuses } from "../src/whatsapp-status";
const envelope = (value: unknown) => ({
  object: "whatsapp_business_account",
  entry: [{ changes: [{ field: "messages", value }] }],
});
it("normalizes signed status data and discards error details", () => {
  const parsed = parseWhatsAppStatuses(
    envelope({
      metadata: { phone_number_id: "123" },
      statuses: [
        {
          id: "wamid.test",
          recipient_id: "12025550100",
          status: "delivered",
          timestamp: "1919851200",
          biz_opaque_callback_data: "attempt",
          errors: [{ message: "private" }],
        },
      ],
    }),
  );
  expect(parsed).toEqual([
    {
      phoneNumberId: "123",
      providerMessageId: "wamid.test",
      recipient: "+12025550100",
      state: "delivered",
      providerTimestamp: new Date(1919851200000),
      attemptId: "attempt",
    },
  ]);
  expect(parseWhatsAppStatuses(envelope({ messages: [] }))).toEqual([]);
  expect(() => parseWhatsAppStatuses(envelope({ statuses: [{ id: "missing fields" }] }))).toThrow(
    "Invalid WhatsApp status payload",
  );
  expect(() => parseWhatsAppStatuses(null)).toThrow("Invalid WhatsApp status payload");
});
