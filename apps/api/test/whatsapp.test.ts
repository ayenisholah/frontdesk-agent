import { request as httpRequest } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const secret = "fictional-secret";
const payload = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: "123" },
            messages: [
              {
                id: "fictional-id",
                from: "12025550100",
                timestamp: "1920000000",
                type: "text",
                text: { body: "private-content" },
              },
            ],
          },
        },
      ],
    },
  ],
});
function setup() {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const accept = vi.fn().mockResolvedValue("accepted");
  const app = createApp({
    checks: {},
    log,
    release: "test",
    whatsapp: { appSecret: secret, verifyToken: "fictional-token", accept },
  });
  const post = (
    body = payload,
    signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
  ) =>
    request(app)
      .post("/webhooks/whatsapp")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", signature)
      .send(body);
  return { app, log, accept, post };
}

describe("WhatsApp webhook", () => {
  it("verifies a subscription and rejects invalid challenges", async () => {
    const { app } = setup();
    const query = {
      "hub.mode": "subscribe",
      "hub.verify_token": "fictional-token",
      "hub.challenge": "12345",
    };
    const response = await request(app).get("/webhooks/whatsapp").query(query);
    expect(response.status).toBe(200);
    expect(response.text).toBe("12345");
    for (const invalid of [
      {},
      { ...query, "hub.mode": "other" },
      { ...query, "hub.verify_token": "wrong" },
      { ...query, "hub.challenge": "" },
    ])
      expect((await request(app).get("/webhooks/whatsapp").query(invalid)).status).toBe(403);
  });
  it("persists authenticated messages and acknowledges duplicates", async () => {
    const { post, accept, log } = setup();
    expect((await post()).status).toBe(200);
    expect(accept).toHaveBeenCalledOnce();
    accept.mockResolvedValue("duplicate");
    expect((await post()).status).toBe(200);
    expect(JSON.stringify(log.info.mock.calls)).not.toMatch(
      /private-content|12025550100|fictional-secret/,
    );
  });
  it("rejects invalid requests before any writes", async () => {
    const { post, app, accept } = setup();
    expect((await post(payload, "invalid")).status).toBe(401);
    expect((await request(app).post("/webhooks/whatsapp").send({})).status).toBe(401);
    expect((await post("{")).status).toBe(400);
    expect((await post("{}")).status).toBe(400);
    expect((await post("x".repeat(1024 * 1024 + 1))).status).toBe(413);
    expect(accept).not.toHaveBeenCalled();
  });
  it("rejects empty or compressed requests and ignores status events", async () => {
    const { app, post, accept } = setup();
    expect((await request(app).post("/webhooks/whatsapp")).status).toBe(401);
    expect(
      (
        await request(app)
          .post("/webhooks/whatsapp")
          .set("Content-Encoding", "gzip")
          .send("compressed")
      ).status,
    ).toBe(400);
    expect(
      (await post(JSON.stringify({ object: "whatsapp_business_account", entry: [] }))).status,
    ).toBe(200);
    expect(accept).not.toHaveBeenCalled();
  });
  it("rejects an HTTP request with no body framing", async () => {
    const { app, accept } = setup();
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: "127.0.0.1",
            port: (server.address() as AddressInfo).port,
            path: "/webhooks/whatsapp",
            method: "POST",
            setDefaultHeaders: false,
            headers: { Host: "localhost" },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode));
          },
        );
        req.on("error", reject);
        req.end();
      });
      expect(status).toBe(401);
      expect(accept).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("never logs verification query strings, untrusted paths or raw errors", async () => {
    const { app, log } = setup();
    await request(app).get("/webhooks/whatsapp").query({
      "hub.mode": "subscribe",
      "hub.verify_token": "private-token",
      "hub.challenge": "private-challenge",
    });
    await request(app).get("/12025550100/private-content");
    const checks = {
      postgres: async () => {
        throw new Error("private-database-password");
      },
    };
    await request(createApp({ checks, log, release: "test" })).get("/readyz");
    const broken = {
      get postgres(): never {
        throw new Error("private-unhandled-error");
      },
    };
    await request(createApp({ checks: broken, log, release: "test" })).get("/readyz");
    expect(
      JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls]),
    ).not.toMatch(/private-|12025550100/);
  });
  it("returns retryable errors without leaking storage failures", async () => {
    const { post, accept, log } = setup();
    accept.mockResolvedValue("unregistered");
    expect((await post()).status).toBe(503);
    accept.mockResolvedValue("conflict");
    expect((await post()).status).toBe(409);
    accept.mockRejectedValue(new Error("private-content 12025550100"));
    expect((await post()).status).toBe(503);
    expect(JSON.stringify([log.warn.mock.calls, log.error.mock.calls])).not.toMatch(
      /private-content|12025550100/,
    );
  });
  it("is disabled by default and requires secrets when enabled", async () => {
    const { log } = setup();
    expect(
      (await request(createApp({ checks: {}, log, release: "test" })).post("/webhooks/whatsapp"))
        .status,
    ).toBe(404);
    const env = { DATABASE_URL: "postgresql://u:p@localhost/db", REDIS_URL: "redis://localhost" };
    expect(loadConfig(env).WHATSAPP_WEBHOOK_ENABLED).toBe(false);
    expect(() => loadConfig({ ...env, WHATSAPP_WEBHOOK_ENABLED: "true" })).toThrow(
      "Invalid configuration",
    );
    expect(() => loadConfig({ ...env, WHATSAPP_WEBHOOK_ENABLED: "invalid" })).toThrow(
      "Invalid configuration",
    );
    expect(
      loadConfig({
        ...env,
        WHATSAPP_WEBHOOK_ENABLED: "true",
        WHATSAPP_APP_SECRET: secret,
        WHATSAPP_VERIFY_TOKEN: "token",
      }).WHATSAPP_WEBHOOK_ENABLED,
    ).toBe(true);
  });
});
