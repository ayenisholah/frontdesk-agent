import { describe, expect, it, vi } from "vitest";
import {
  createChecks,
  createDependencies,
  withTimeout,
  type PostgresProbe,
  type RedisProbe,
} from "../src/checks.js";

const healthyPostgres: PostgresProbe = { query: async () => ({ rows: [] }) };

const redisProbe = (overrides: Partial<RedisProbe> = {}): RedisProbe => ({
  status: "ready",
  connect: vi.fn(async () => {}),
  ping: async () => "PONG",
  ...overrides,
});

const never = () => new Promise<never>(() => {});

describe("withTimeout", () => {
  it("resolves with the value when the promise wins", async () => {
    await expect(withTimeout(Promise.resolve(7), 50, "x")).resolves.toBe(7);
  });

  it("rejects naming the dependency when time runs out", async () => {
    await expect(withTimeout(never(), 1, "postgres")).rejects.toThrow("postgres timed out");
  });
});

describe("postgres check", () => {
  it("passes when the query answers", async () => {
    await expect(createChecks(healthyPostgres, redisProbe()).postgres!()).resolves.toBeUndefined();
  });

  it("fails when the query hangs", async () => {
    const checks = createChecks({ query: never }, redisProbe(), 1);
    await expect(checks.postgres!()).rejects.toThrow("postgres timed out");
  });
});

describe("redis check", () => {
  it("pings without reconnecting when already connected", async () => {
    const redis = redisProbe();
    await createChecks(healthyPostgres, redis).redis!();
    expect(redis.connect).not.toHaveBeenCalled();
  });

  it.each(["wait", "end"])("connects first when the status is %s", async (status) => {
    const redis = redisProbe({ status });
    await createChecks(healthyPostgres, redis).redis!();
    expect(redis.connect).toHaveBeenCalledOnce();
  });

  it("fails on an unexpected ping reply", async () => {
    const redis = redisProbe({ ping: async () => "NOPE" });
    await expect(createChecks(healthyPostgres, redis).redis!()).rejects.toThrow("unexpected reply");
  });
});

describe("createDependencies", () => {
  it("reports unreachable services through checks and still closes cleanly", async () => {
    const deps = createDependencies("postgresql://u:p@127.0.0.1:1/db", "redis://127.0.0.1:1");
    await expect(deps.checks.postgres!()).rejects.toThrow();
    await expect(deps.checks.redis!()).rejects.toThrow();
    await expect(deps.close()).resolves.toBeUndefined();
  });
});
