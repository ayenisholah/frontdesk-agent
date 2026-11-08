import { expect, it, vi } from "vitest";
import { createWorkerHealth } from "../src/health";
it("distinguishes liveness, readiness, shutdown and bounded metrics without leaking errors", async () => {
  const probe = vi.fn().mockResolvedValue(undefined);
  const controller = new AbortController();
  const report = vi.fn();
  const health = createWorkerHealth(probe, controller.signal, report);
  expect(await health.respond("GET", "/healthz")).toEqual({ status: 200, body: "ok\n" });
  expect((await health.respond("GET", "/readyz")).status).toBe(200);
  probe.mockRejectedValueOnce(new Error("private"));
  expect(await health.respond("GET", "/readyz")).toEqual({ status: 503, body: "unavailable\n" });
  health.report("dispatch_failed");
  health.report("retention_failed");
  health.report("queue_failed");
  expect(report.mock.calls).toEqual([["dispatch_failed"], ["retention_failed"], ["queue_failed"]]);
  expect((await health.respond("GET", "/metrics")).body).toContain("worker_queue_failed_total 1");
  controller.abort();
  expect((await health.respond("GET", "/readyz")).status).toBe(503);
  expect((await health.respond("POST", "/healthz")).status).toBe(405);
  expect((await health.respond(undefined, undefined)).status).toBe(405);
  expect((await health.respond("GET", "/missing")).status).toBe(404);
});
it("bounds readiness time even when a dependency never responds", async () => {
  vi.useFakeTimers();
  try {
    const health = createWorkerHealth(
      () => new Promise(() => {}),
      new AbortController().signal,
      () => {},
    );
    const pending = health.respond("GET", "/readyz");
    await vi.advanceTimersByTimeAsync(2000);
    expect((await pending).status).toBe(503);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
