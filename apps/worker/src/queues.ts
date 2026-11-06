import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
import type { InboxRef } from "@frontdesk/db";

const jobSchema = z.strictObject({
  businessId: z.uuid(),
  sequence: z.string().regex(/^[1-9]\d{0,18}$/),
});

/** Redis holds references only. Database state, not queue retention, provides idempotency. */
export function createQueues(options: { url: string; prefix: string; report: () => void }) {
  const producer = new Redis(options.url, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  const consumer = new Redis(options.url, { maxRetriesPerRequest: null });
  const shared = { connection: producer, prefix: options.prefix };
  const inbound = new Queue<InboxRef>("inbound", shared);
  const outbound = new Queue("outbound", shared);
  const dead = new Queue("dead", shared);
  const workers: Worker[] = [];
  for (const emitter of [producer, consumer, inbound, outbound, dead])
    emitter.on("error", options.report);
  return {
    inbound,
    outbound,
    dead,
    worker(handle: (ref: InboxRef) => Promise<void>) {
      const worker = new Worker(
        "inbound",
        async (job) => {
          const parsed = jobSchema.safeParse(job.data);
          if (!parsed.success) throw new Error("Invalid queue payload");
          await handle(parsed.data);
        },
        { connection: consumer, prefix: options.prefix, concurrency: 4 },
      );
      worker.on("error", options.report);
      workers.push(worker);
      return worker;
    },
    async close() {
      try {
        await Promise.all(workers.map((worker) => worker.close()));
        await Promise.all([inbound.close(), outbound.close(), dead.close()]);
      } finally {
        producer.disconnect();
        consumer.disconnect();
      }
    },
  };
}
