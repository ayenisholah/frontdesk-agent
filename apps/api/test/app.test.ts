import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/log.js";

const log = createLogger("error");
const quiet = { ...log, error: () => {}, warn: () => {} };
const ok = async () => {};
const down = async () => {
  throw new Error("connection refused");
};

describe("api health", () => {
  it("GET /healthz is always 200 and reports the release", async () => {
    const app = createApp({ checks: { postgres: down }, log, release: "abc123" });
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", release: "abc123" });
  });

  it("GET /readyz is 200 when every dependency answers", async () => {
    const app = createApp({ checks: { postgres: ok, redis: ok }, log, release: "x" });
    const res = await request(app).get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body.checks).toEqual({ postgres: "ok", redis: "ok" });
  });

  it("GET /readyz is 503 and names the failing dependency", async () => {
    const app = createApp({ checks: { postgres: ok, redis: down }, log: quiet, release: "x" });
    const res = await request(app).get("/readyz");
    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({ postgres: "ok", redis: "fail" });
  });

  it("sets security headers and hides Express", async () => {
    const app = createApp({ checks: {}, log, release: "x" });
    const res = await request(app).get("/healthz");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it("returns JSON 404 for unknown routes", async () => {
    const app = createApp({ checks: {}, log, release: "x" });
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
  });

  it("turns an unhandled error into a JSON 500 without leaking its message", async () => {
    const checks = {
      get postgres(): never {
        throw new Error("secret detail");
      },
    };
    const res = await request(createApp({ checks, log: quiet, release: "x" })).get("/readyz");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "internal" });
  });
});

describe("config", () => {
  it("applies defaults to a minimal valid environment", () => {
    const config = loadConfig({
      DATABASE_URL: "postgresql://u:p@db/x",
      REDIS_URL: "redis://cache",
    });
    expect(config).toMatchObject({ PORT: 3110, LOG_LEVEL: "info", RELEASE_SHA: "dev" });
  });

  it("rejects a missing DATABASE_URL without echoing values", () => {
    expect(() => loadConfig({ REDIS_URL: "redis://:secret@localhost:6379" })).toThrow(
      /Invalid configuration: DATABASE_URL/,
    );
    try {
      loadConfig({ REDIS_URL: "redis://:secret@localhost:6379" });
    } catch (e) {
      expect((e as Error).message).not.toContain("secret");
    }
  });
});
