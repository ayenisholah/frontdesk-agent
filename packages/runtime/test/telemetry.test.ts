import { afterEach, expect, it, vi } from "vitest";
import { createTelemetry, parseTelemetryConfig } from "../src/telemetry";
afterEach(() => vi.useRealTimers());
it("validates opt-in configuration without accepting arbitrary dimensions", () => {
  expect(parseTelemetryConfig({})).toBeUndefined();
  expect(parseTelemetryConfig({ TELEMETRY_ENABLED: "false" })).toBeUndefined();
  expect(parseTelemetryConfig({ TELEMETRY_ENABLED: "true", TELEMETRY_STAGE: "pilot" })).toEqual({
    stage: "pilot",
  });
  for (const env of [
    { TELEMETRY_ENABLED: "yes" },
    { TELEMETRY_ENABLED: "true" },
    { TELEMETRY_ENABLED: "true", TELEMETRY_STAGE: "customer-secret" },
  ])
    expect(() => parseTelemetryConfig(env)).toThrow("Invalid telemetry configuration");
});
it("publishes bounded dimensions and failure deltas; stops sampling on shutdown", async () => {
  vi.useFakeTimers();
  const output = vi.fn();
  const probe = vi.fn().mockResolvedValue(undefined);
  const telemetry = createTelemetry({
    service: "worker",
    stage: "pilot",
    clock: () => 100,
    output,
    probe,
  });
  telemetry.report("queue_failed");
  await vi.advanceTimersByTimeAsync(0);
  expect(output.mock.calls[0]![0]).toMatchObject({
    Stage: "pilot",
    Service: "worker",
    Heartbeat: 1,
    Ready: 1,
    queue_failed: 1,
  });
  expect(output.mock.calls[0]![0]._aws.CloudWatchMetrics[0].Dimensions).toEqual([
    ["Stage", "Service"],
  ]);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(output.mock.calls[1]![0].queue_failed).toBe(0);
  telemetry.stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(probe).toHaveBeenCalledTimes(2);
});
it("bounds failed or stuck probes, avoids overlap and contains output failures", async () => {
  vi.useFakeTimers();
  const output = vi.fn();
  let finish!: () => void;
  const probe = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockRejectedValue(new Error("private"));
  const telemetry = createTelemetry({
    service: "api",
    stage: "pilot",
    clock: () => 1,
    output,
    probe,
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(output.mock.calls[0]![0].Ready).toBe(0);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(probe).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(probe).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(output.mock.calls)).not.toContain("private");
  output.mockImplementation(() => {
    throw new Error("sink unavailable");
  });
  await vi.advanceTimersByTimeAsync(60_000);
  telemetry.stop();
});
it("does not publish an in-flight result after shutdown", async () => {
  vi.useFakeTimers();
  const output = vi.fn();
  const telemetry = createTelemetry({
    service: "api",
    stage: "pilot",
    clock: () => 1,
    output,
    probe: () => new Promise(() => {}),
  });
  telemetry.stop();
  await vi.advanceTimersByTimeAsync(3000);
  expect(output).not.toHaveBeenCalled();
});
