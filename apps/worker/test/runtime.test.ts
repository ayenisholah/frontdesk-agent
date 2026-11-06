import { afterEach, expect, it, vi } from "vitest";
import { createRuntime } from "../src/runtime";
import { parseWorkerConfig } from "../src/config";

afterEach(() => vi.useRealTimers());
it("requires infrastructure, defaults off, and rejects unsafe configuration without exposing values", () => {
  const env = { DATABASE_URL: "postgresql://localhost/test", REDIS_URL: "redis://localhost" };
  expect(parseWorkerConfig(env)).toMatchObject({
    inbound: false,
    outbound: false,
    retention: false,
    days: 90,
  });
  expect(
    parseWorkerConfig({ ...env, CONTENT_RETENTION_ENABLED: "true", INBOUND_WORKER_ENABLED: "true" })
      .inbound,
  ).toBe(true);
  for (const invalid of [
    {},
    { ...env, INBOUND_WORKER_ENABLED: "yes" },
    { ...env, OUTBOUND_WORKER_ENABLED: "true" },
    { ...env, CONTENT_RETENTION_DAYS: "0" },
  ])
    expect(() => parseWorkerConfig(invalid)).toThrow("Invalid worker configuration");
});
it("starts each nonoverlapping loop immediately, retries errors, and drains before closing", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const dispatch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error("secret"))
    .mockResolvedValue(undefined);
  const retain = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn().mockResolvedValue(undefined);
  const report = vi.fn();
  const runtime = createRuntime({ dispatch, retain, close, report });
  await vi.advanceTimersByTimeAsync(2000);
  expect(dispatch).toHaveBeenCalledTimes(1);
  release();
  await vi.advanceTimersByTimeAsync(1000);
  expect(report).toHaveBeenCalledWith("dispatch_failed");
  await vi.advanceTimersByTimeAsync(86_400_000);
  expect(retain).toHaveBeenCalledTimes(2);
  await Promise.all([runtime.stop(), runtime.stop()]);
  expect(runtime.signal.aborted).toBe(true);
  expect(close).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it("reports retention failures with a fixed event and waits for active work on stop", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const close = vi.fn().mockResolvedValue(undefined);
  const report = vi.fn();
  const runtime = createRuntime({
    dispatch: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    retain: () => Promise.reject(new Error("secret")),
    close,
    report,
  });
  await vi.advanceTimersByTimeAsync(0);
  const stopped = runtime.stop();
  expect(close).not.toHaveBeenCalled();
  release();
  await stopped;
  expect(report).toHaveBeenCalledWith("retention_failed");
});
