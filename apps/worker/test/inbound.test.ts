import { describe, expect, it, vi } from "vitest";
import { createInboundProcessor } from "../src/inbound";
import type { InboxClaim } from "@frontdesk/db";

const claim = {
  state: "claimed",
  lease: { sequence: "1", token: 1 },
  scope: { businessId: "b", customerId: "c", conversationId: "t" },
  messageId: "m",
  kind: "text",
  recovered: false,
} as const;
const ref = { businessId: "b", sequence: "1" };
function fixture() {
  const inbox = {
    claim: vi.fn<() => Promise<InboxClaim>>().mockResolvedValue(claim),
    renew: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    retryBeforeStart: vi.fn().mockResolvedValue(undefined),
  };
  const dependencies = {
    inbox: () => inbox,
    prepare: vi.fn<() => Promise<"run" | "finished">>().mockResolvedValue("run"),
    execute: vi.fn().mockResolvedValue({ state: "replied" }),
    report: vi.fn(),
  };
  return { ...dependencies, process: createInboundProcessor(dependencies) };
}
describe("inbound processor", () => {
  it("passes shutdown cancellation into active inference", async () => {
    const f = fixture();
    const controller = new AbortController();
    let observed!: AbortSignal;
    f.execute.mockImplementation(async (_claim, signal: AbortSignal) => {
      observed = signal;
      controller.abort();
      return { state: "replied" };
    });
    await createInboundProcessor({ ...f, shutdownSignal: controller.signal })(ref);
    expect(observed.aborted).toBe(true);
  });
  it("ignores unclaimed work and completes already handled work without inference", async () => {
    const f = fixture();
    f.inbox().claim.mockResolvedValueOnce({ state: "busy" });
    await f.process(ref);
    expect(f.prepare).not.toHaveBeenCalled();
    f.prepare.mockResolvedValueOnce("finished");
    await f.process(ref);
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("runs once and marks silent turns skipped", async () => {
    const f = fixture();
    await f.process(ref);
    expect(f.execute).toHaveBeenCalledOnce();
    f.execute.mockResolvedValueOnce({ state: "silent" });
    await f.process(ref);
    expect(f.inbox().complete).toHaveBeenCalledWith(claim.lease, "skipped", "owner");
  });
  it("recovers failed runs and only retries when no run started", async () => {
    const f = fixture();
    f.execute.mockRejectedValue(new Error("private"));
    f.prepare.mockResolvedValueOnce("run").mockResolvedValueOnce("finished");
    await f.process(ref);
    expect(f.inbox().retryBeforeStart).not.toHaveBeenCalled();
    await f.process(ref);
    expect(f.inbox().retryBeforeStart).toHaveBeenCalledWith(claim.lease);
    f.execute.mockResolvedValueOnce({ state: "busy" });
    await f.process(ref);
    expect(f.inbox().retryBeforeStart).toHaveBeenCalledTimes(2);
  });
  it("renews every 20 seconds and cancels on lease loss or the whole-turn deadline", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      let signal!: AbortSignal;
      f.execute.mockImplementation((_claim, s: AbortSignal) => {
        signal = s;
        return new Promise((resolve) =>
          s.addEventListener("abort", () => resolve({ state: "replied" }), { once: true }),
        );
      });
      const running = f.process(ref);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(f.inbox().renew).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(280_000);
      await running;
      expect(signal.aborted).toBe(true);
      const next = f.process(ref);
      f.inbox().renew.mockRejectedValueOnce(new Error("private"));
      await vi.advanceTimersByTimeAsync(20_000);
      await next;
      expect(signal.aborted).toBe(true);
      expect(f.report).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
