import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseWhatsAppWebhook, verifyWhatsAppSignature } from "../src/index";

const envelope = (messages: unknown[]) => ({
  object: "whatsapp_business_account",
  entry: [
    { changes: [{ field: "messages", value: { metadata: { phone_number_id: "123" }, messages } }] },
  ],
});
const message = {
  id: "wamid.fictional",
  from: "12025550100",
  timestamp: "1920000000",
  type: "text",
  text: { body: "Hello" },
};

describe("WhatsApp boundary", () => {
  it("authenticates the exact bytes and rejects missing, malformed and tampered signatures", () => {
    const body = Buffer.from('{"hello":true}');
    const signature = `sha256=${createHmac("sha256", "fictional-secret").update(body).digest("hex")}`;
    expect(verifyWhatsAppSignature(body, signature, "fictional-secret")).toBe(true);
    for (const invalid of [
      undefined,
      "",
      "sha256=00",
      "sha256=" + "z".repeat(64),
      "sha256=" + "0".repeat(64),
    ])
      expect(verifyWhatsAppSignature(body, invalid, "fictional-secret")).toBe(false);
    expect(verifyWhatsAppSignature(Buffer.from("{}"), signature, "fictional-secret")).toBe(false);
  });
  it("normalizes all entries and replaces unsupported content with a fixed placeholder", () => {
    const payload = envelope([
      message,
      { ...message, id: "media", type: "audio", audio: { id: "private-media" } },
    ]);
    payload.entry.push(...envelope([{ ...message, id: "second" }]).entry);
    expect(parseWhatsAppWebhook(payload)).toEqual([
      {
        phoneNumberId: "123",
        providerMessageId: message.id,
        phone: "+12025550100",
        providerTimestamp: new Date(1920000000000),
        kind: "text",
        body: "Hello",
      },
      {
        phoneNumberId: "123",
        providerMessageId: "media",
        phone: "+12025550100",
        providerTimestamp: new Date(1920000000000),
        kind: "unsupported",
        body: "[Unsupported WhatsApp message]",
      },
      {
        phoneNumberId: "123",
        providerMessageId: "second",
        phone: "+12025550100",
        providerTimestamp: new Date(1920000000000),
        kind: "text",
        body: "Hello",
      },
    ]);
  });
  it("ignores status-only and unrelated events", () => {
    expect(parseWhatsAppWebhook(envelope([]))).toEqual([]);
    expect(
      parseWhatsAppWebhook({
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              { field: "messages", value: { statuses: [{}] } },
              { field: "other", value: {} },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });
  it("rejects malformed message boundaries without exposing payload data", () => {
    for (const payload of [
      null,
      {},
      envelope([{ ...message, from: "secret" }]),
      envelope([{ ...message, timestamp: "-1" }]),
      envelope([{ ...message, timestamp: "99999999999999999" }]),
      envelope([{ ...message, text: undefined }]),
      envelope([{ ...message, text: { body: "" } }]),
    ])
      expect(() => parseWhatsAppWebhook(payload)).toThrow("Invalid WhatsApp payload");
  });
});
