import { describe, expect, it, vi } from "vitest";
import { createWhatsAppSender } from "../src/whatsapp-send";

const message = {
  recipient: "+12025550100",
  attemptId: "11111111-1111-4111-8111-111111111111",
  content: { type: "text" as const, body: "Fictional reply" },
};
const options = { token: "fictional-token", phoneNumberId: "1234", version: "v25.0" };
describe("WhatsApp sender", () => {
  it("sends an explicit-version request and returns only the provider identifier", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ messages: [{ id: "wamid.fictional" }] }), { status: 200 }),
      );
    const send = createWhatsAppSender({ ...options, request });
    expect(await send(message)).toEqual({
      state: "accepted",
      providerMessageId: "wamid.fictional",
    });
    const [url, init] = request.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v25.0/1234/messages");
    expect(JSON.parse(init.body as string)).toMatchObject({
      messaging_product: "whatsapp",
      to: "12025550100",
      type: "text",
      text: { body: "Fictional reply", preview_url: false },
      biz_opaque_callback_data: message.attemptId,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("classifies explicit rejections and honors retry-after", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: 130429, is_transient: true, message: "private detail" },
          }),
          { status: 429, headers: { "retry-after": "12" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 190 } }), { status: 401 }),
      );
    const send = createWhatsAppSender({ ...options, request });
    expect(await send(message)).toEqual({ state: "retryable_rejection", retryAfterMs: 12000 });
    expect(await send(message)).toEqual({ state: "permanent_rejection" });
  });
  it("never treats ambiguous failures as safe to retry", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("private connection failure"))
      .mockResolvedValueOnce(new Response("gateway failure", { status: 502 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const send = createWhatsAppSender({ ...options, request });
    for (let n = 0; n < 3; n++) expect(await send(message)).toEqual({ state: "uncertain" });
  });
  it("sends approved-template payloads and refuses malformed configuration", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response('{"messages":[{"id":"wamid.template"}]}'));
    const send = createWhatsAppSender({ ...options, request });
    await send({
      ...message,
      content: {
        type: "template",
        name: "owner_incident",
        language: "en",
        incidentId: message.attemptId,
      },
    });
    expect(JSON.parse(request.mock.calls[0]![1].body as string).template).toMatchObject({
      name: "owner_incident",
      language: { code: "en" },
    });
    expect(() => createWhatsAppSender({ ...options, version: "../invalid", request })).toThrow(
      "Invalid sender configuration",
    );
  });
});

it("handles explicit transient variants, missing retry headers and fixed templates", async () => {
  expect(createWhatsAppSender(options)).toBeTypeOf("function");
  const responses = [
    new Response('{"error":{"code":1}}', { status: 500 }),
    new Response('{"error":{"code":2,"is_transient":true}}', {
      status: 400,
      headers: { "retry-after": "invalid" },
    }),
    new Response("{}", { status: 500 }),
    new Response('{"error":{"code":4}}', { status: 429, headers: { "retry-after": "999999" } }),
    new Response('{"messages":[{"id":"wamid.fixed"}]}'),
  ];
  const request = vi.fn(async () => responses.shift()!);
  const send = createWhatsAppSender({ ...options, request });
  expect(await send(message)).toEqual({ state: "retryable_rejection", retryAfterMs: 0 });
  expect(await send(message)).toEqual({ state: "retryable_rejection", retryAfterMs: 0 });
  expect(await send(message)).toEqual({ state: "uncertain" });
  expect(await send(message)).toEqual({ state: "retryable_rejection", retryAfterMs: 86400000 });
  expect(
    await send({ ...message, content: { type: "template", name: "fixed", language: "en" } }),
  ).toEqual({ state: "accepted", providerMessageId: "wamid.fixed" });
});

it("honors an HTTP-date Retry-After", async () => {
  const request = vi.fn().mockResolvedValue(
    new Response('{"error":{"code":4}}', {
      status: 429,
      headers: { "retry-after": new Date(Date.now() + 10000).toUTCString() },
    }),
  );
  const result = await createWhatsAppSender({ ...options, request })(message);
  expect(result.state).toBe("retryable_rejection");
  if (result.state === "retryable_rejection") expect(result.retryAfterMs).toBeGreaterThan(8000);
});

it("backs off on Meta's explicit pair-rate rejection even when HTTP is 400", async () => {
  const request = vi
    .fn()
    .mockResolvedValue(new Response('{"error":{"code":131056}}', { status: 400 }));
  expect(await createWhatsAppSender({ ...options, request })(message)).toEqual({
    state: "retryable_rejection",
    retryAfterMs: 0,
  });
});
