import type { JobsOptions } from "bullmq";
import type { InboxRef } from "@frontdesk/db";

type Source = { listDue(): Promise<InboxRef[]> };
type Publisher = { add(name: string, data: InboxRef, options: JobsOptions): Promise<unknown> };

/** Postgres stays pending until processing commits; a failed publish cannot lose work. */
export async function dispatchInbox(source: Source, queue: Publisher) {
  const rows = await source.listDue();
  for (const row of rows) {
    await queue.add("inbound", row, {
      jobId: `inbound-${row.sequence}`,
      attempts: 5,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: true,
      removeOnFail: true,
    });
  }
  return rows.length;
}
