import type { JobsOptions } from "bullmq";
import type { InboxRef, DeliveryRef } from "@frontdesk/db";
type Source<T> = { listDue(): Promise<T[]> };
type Publisher<T> = { add(name: string, data: T, options: JobsOptions): Promise<unknown> };

/** Postgres stays pending until processing commits; a failed publish cannot lose work. */
async function publish<T>(
  source: Source<T>,
  queue: Publisher<T>,
  job: { name: string; id(row: T): string },
) {
  const rows = await source.listDue();
  for (const row of rows)
    await queue.add(job.name, row, {
      jobId: `${job.name}-${job.id(row)}`,
      attempts: 5,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: true,
      removeOnFail: true,
    });
  return rows.length;
}
export const dispatchInbox = (source: Source<InboxRef>, queue: Publisher<InboxRef>) =>
  publish(source, queue, { name: "inbound", id: (row) => row.sequence });
export const dispatchOutbound = (source: Source<DeliveryRef>, queue: Publisher<DeliveryRef>) =>
  publish(source, queue, { name: "outbound", id: (row) => row.id });

export const dispatchDead = (source: Source<DeliveryRef>, queue: Publisher<DeliveryRef>) =>
  publish(source, queue, { name: "dead", id: (row) => row.id });
