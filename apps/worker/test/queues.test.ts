import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createQueues } from "../src/queues";

const url = process.env.REDIS_URL;
describe.skipIf(!url)("BullMQ transport", () => {
  it("deduplicates publications, validates jobs and processes identifiers only", async () => {
    const report = vi.fn();
    const queues = createQueues({ url: url!, prefix: `test-${randomUUID()}`, report });
    try {
      await queues.inbound.waitUntilReady();
      const ref = { businessId: randomUUID(), sequence: "1" };
      await queues.inbound.add("inbound", ref, { jobId: "inbound-1" });
      await queues.inbound.add("inbound", ref, { jobId: "inbound-1" });
      expect(await queues.inbound.getWaitingCount()).toBe(1);
      const handle = vi.fn().mockResolvedValue(undefined);
      const worker = queues.worker(handle);
      await vi.waitFor(() => expect(handle).toHaveBeenCalledWith(ref), { timeout: 5000 });
      const invalid = { ...ref, body: "private content" };
      await queues.inbound.add("inbound", invalid, { jobId: "bad" });
      await vi.waitFor(async () => expect(await queues.inbound.getFailedCount()).toBe(1), {
        timeout: 5000,
      });
      expect(handle).toHaveBeenCalledTimes(1);
      const emitters: { emit(event: "error", error: Error): boolean }[] = [
        queues.inbound,
        queues.outbound,
        queues.dead,
        worker,
      ];
      for (const emitter of emitters) emitter.emit("error", new Error("private error"));
      expect(report).toHaveBeenCalledTimes(4);
      await worker.close();
      await Promise.all([
        queues.inbound.obliterate({ force: true }),
        queues.outbound.obliterate({ force: true }),
        queues.dead.obliterate({ force: true }),
      ]);
    } finally {
      await queues.close();
    }
  });
});
