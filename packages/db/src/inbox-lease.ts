import type { Tx } from "./client";

export type InboxLease = { sequence: string; token: number };
export class LeaseLost extends Error {
  constructor() {
    super("Lease lost");
    this.name = "LeaseLost";
  }
}
export function inboxId(sequence: string) {
  if (!/^[1-9]\d{0,18}$/.test(sequence) || BigInt(sequence) > 9223372036854775807n)
    throw new Error("Invalid inbox id");
  return BigInt(sequence);
}
/** The row lock serializes lease replacement with protected mutations. */
export async function assertInboxLease(tx: Tx, businessId: string, lease: InboxLease, now: Date) {
  const rows = await tx.$queryRaw<{ sequence: bigint }[]>`
    SELECT "sequence" FROM "InboundWork"
    WHERE "businessId" = ${businessId}::uuid AND "sequence" = ${inboxId(lease.sequence)}
      AND "leaseToken" = ${lease.token} AND "state" = 'processing' AND "leaseUntil" > ${now}
    FOR UPDATE`;
  if (!rows.length) throw new LeaseLost();
}
