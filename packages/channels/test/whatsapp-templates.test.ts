import { expect, it, vi } from "vitest";
import { verifyWhatsAppTemplates } from "../src/whatsapp-templates";
const config = {
  token: "fictional",
  version: "v25.0",
  wabaId: "123",
  owner: { name: "owner_incident", language: "en" },
  customer: { name: "owner_followup", language: "en" },
};
it("records only exact approved templates and rejects missing or unapproved entries", async () => {
  const request = vi.fn(
    async (url: string | URL | Request) =>
      new Response(
        JSON.stringify({
          data: [
            {
              name: new URL(url as string).searchParams.get("name"),
              language: "en",
              status: "APPROVED",
            },
          ],
        }),
      ),
  );
  const now = new Date("2031-03-03T12:00:00Z");
  expect(await verifyWhatsAppTemplates(config, { request, clock: () => now })).toEqual({
    owner: { ...config.owner, verifiedAt: now.toISOString() },
    customer: { ...config.customer, verifiedAt: now.toISOString() },
  });
  const rejected = vi
    .fn()
    .mockResolvedValue(
      new Response('{"data":[{"name":"owner_incident","language":"en","status":"REJECTED"}]}'),
    );
  await expect(
    verifyWhatsAppTemplates(config, { request: rejected, clock: () => now }),
  ).rejects.toThrow("Template verification failed");
  await expect(
    verifyWhatsAppTemplates({ ...config, wabaId: "../bad" }, { request, clock: () => now }),
  ).rejects.toThrow("Invalid template configuration");
});

it("rejects HTTP failures and verifies an owner-only selection exactly", async () => {
  const clock = () => new Date("2031-03-03T12:00:00Z");
  const failure = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
  await expect(verifyWhatsAppTemplates(config, { request: failure, clock })).rejects.toThrow(
    "Template verification failed",
  );
  const request = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: [
          { name: "different", language: "en", status: "APPROVED" },
          { name: "owner_incident", language: "fr", status: "APPROVED" },
          { name: "owner_incident", language: "en", status: "APPROVED" },
        ],
      }),
    ),
  );
  expect(
    await verifyWhatsAppTemplates({ ...config, customer: undefined }, { request, clock }),
  ).toEqual({ owner: { ...config.owner, verifiedAt: clock().toISOString() } });
});
