import { expect, it } from "vitest";
import { resolveRuntimeEnvironment } from "../src/index";
const cloud = {
  CLOUD_RUNTIME: "true",
  DATABASE_HOST: "postgres.example.test",
  DATABASE_NAME: "frontdesk",
  DATABASE_USER: "frontdesk_runtime",
  DATABASE_PASSWORD: "fictional:/?#@password",
  REDIS_HOST: "redis.example.test",
  REDIS_PASSWORD: "fictional:/?#@token",
  NODE_EXTRA_CA_CERTS: "/app/certs/rds.pem",
};
it("preserves local configuration and builds verified TLS URLs from injected credentials", () => {
  expect(resolveRuntimeEnvironment({ DATABASE_URL: "local" })).toEqual({ DATABASE_URL: "local" });
  expect(resolveRuntimeEnvironment({ CLOUD_RUNTIME: "false" })).toEqual({ CLOUD_RUNTIME: "false" });
  const env = resolveRuntimeEnvironment(cloud);
  const db = new URL(env.DATABASE_URL!);
  expect(decodeURIComponent(db.password)).toBe(cloud.DATABASE_PASSWORD);
  expect(db.searchParams.get("sslmode")).toBe("verify-full");
  expect(db.hostname).toBe(cloud.DATABASE_HOST);
  expect(new URL(env.REDIS_URL!).protocol).toBe("rediss:");
  expect(decodeURIComponent(new URL(env.REDIS_URL!).password)).toBe(cloud.REDIS_PASSWORD);
});
it("fails closed on ambiguous, incomplete or insecure cloud configuration without leaking it", () => {
  for (const env of [
    { CLOUD_RUNTIME: "yes" },
    { ...cloud, DATABASE_PASSWORD: "" },
    { ...cloud, NODE_EXTRA_CA_CERTS: "" },
    { ...cloud, NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    { ...cloud, DATABASE_URL: "private" },
    { ...cloud, REDIS_URL: "private" },
    { ...cloud, DATABASE_HOST: "evil/host" },
  ])
    expect(() => resolveRuntimeEnvironment(env)).toThrow("Invalid cloud runtime configuration");
});
