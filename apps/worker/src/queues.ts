import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
import type { InboxRef, DeliveryRef } from "@frontdesk/db";
import { createSendLimiter } from "./rate-limit";

const deliverySchema = z.strictObject({ businessId: z.uuid(), id: z.uuid() });
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
  const outbound = new Queue<DeliveryRef>("outbound", shared);
  const dead = new Queue<DeliveryRef>("dead", shared);
  const workers: Worker[] = [];
  for (const emitter of [producer, consumer, inbound, outbound, dead])
    emitter.on("error", options.report);
  return {
    ping: () => producer.ping(),
    limit: createSendLimiter(producer, { prefix: options.prefix }),
    inbound,
    outbound,
    dead,
    worker: (handle: (ref: InboxRef) => Promise<void>) =>
      startWorker({ ...options, consumer, workers }, "inbound", jobSchema, handle),
    outboundWorker: (handle: (ref: DeliveryRef) => Promise<void>) =>
      startWorker({ ...options, consumer, workers }, "outbound", deliverySchema, handle),
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

function startWorker<T>(
  context: { consumer: Redis; prefix: string; workers: Worker[]; report: () => void },
  name: string,
  schema: z.ZodType<T>,
  handle: (ref: T) => Promise<void>,
) {
  const worker = new Worker(
    name,
    async (job) => {
      const parsed = schema.safeParse(job.data);
      if (!parsed.success) throw new Error("Invalid queue payload");
      try {
        await handle(parsed.data);
      } catch {
        throw new Error("Queue processing failed");
      }
    },
    { connection: context.consumer, prefix: context.prefix, concurrency: 4 },
  );
  worker.on("error", context.report);
  context.workers.push(worker);
  return worker;
}
