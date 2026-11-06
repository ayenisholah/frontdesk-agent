import request from "supertest";
import { expect, it } from "vitest";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
it("trusts exactly the ALB hop and ignores attacker-supplied earlier forwarded addresses", async () => {
  const app = createApp({
    checks: {},
    release: "test",
    proxy: "alb",
    log: { info() {}, warn() {}, error() {}, debug() {} },
  });
  const trust = app.get("trust proxy fn") as (address: string, hop: number) => boolean;
  expect(trust("10.42.0.1", 0)).toBe(true);
  expect(trust("198.51.100.10", 1)).toBe(false);
  expect(
    (await request(app).get("/healthz").set("X-Forwarded-For", "attacker, 198.51.100.10")).status,
  ).toBe(200);
  expect(() =>
    loadConfig({
      DATABASE_URL: "postgresql://localhost/db",
      REDIS_URL: "redis://localhost",
      TRUST_PROXY: "true",
    }),
  ).toThrow("Invalid configuration");
});
