import type { Db } from "./client";
import type { Prisma } from "./generated/client";
import { withSlotLock, type Clock } from "./slots";
import { assertInboxLease, inboxId, type InboxLease } from "./inbox-lease";
import type { AgentScope } from "./agent-scope";

export type InboxRef = { businessId: string; sequence: string };
export type InboxClaim =
  | { state: "missing" | "terminal" | "busy" }
  | {
      state: "claimed";
      lease: InboxLease;
      scope: AgentScope;
      messageId: string;
      kind: string;
      recovered: boolean;
    };
const unfinished = ["pending", "processing"];
const leaseUntil = (now: Date) => new Date(now.getTime() + 90_000);

async function claim(
  db: Db,
  businessId: string,
  sequence: string,
  clock: Clock,
): Promise<InboxClaim> {
  const id = inboxId(sequence);
  return withSlotLock(db, businessId, clock, async (tx, now) => {
    const row = await tx.inboundWork.findFirst({
      where: { businessId, sequence: id },
      include: { message: { include: { conversation: true } } },
    });
    if (!row) return { state: "missing" };
    if (!unfinished.includes(row.state)) return { state: "terminal" };
    if (row.nextAttemptAt > now || (row.leaseUntil && row.leaseUntil > now))
      return { state: "busy" };
    const { conversation } = row.message;
    const earlier = await tx.inboundWork.findFirst({
      where: {
        businessId,
        sequence: { lt: id },
        state: { in: unfinished },
        message: { conversationId: conversation.id },
      },
    });
    if (earlier) return { state: "busy" };
    const updated = await tx.inboundWork.update({
      where: { sequence: id, businessId },
      data: {
        state: "processing",
        leaseToken: { increment: 1 },
        leaseUntil: leaseUntil(now),
        attempts: { increment: 1 },
      },
    });
    const lease = { sequence, token: updated.leaseToken };
    return {
      state: "claimed",
      lease,
      scope: { businessId, customerId: conversation.customerId, conversationId: conversation.id },
      messageId: row.messageId,
      kind: row.kind,
      recovered: row.state === "processing",
    };
  });
}

export function createInboxStore(db: Db, businessId: string, clock: Clock) {
  const mutate = (
    lease: InboxLease,
    data: (now: Date) => Prisma.InboundWorkUpdateManyMutationInput,
  ) =>
    withSlotLock(db, businessId, clock, async (tx, now) => {
      await assertInboxLease(tx, businessId, lease, now);
      await tx.inboundWork.updateMany({
        where: { businessId, sequence: inboxId(lease.sequence) },
        data: data(now),
      });
    });
  return {
    async listDead() {
      const rows = await db.inboundWork.findMany({
        where: { businessId, state: "dead" },
        select: { sequence: true },
        orderBy: { sequence: "desc" },
        take: 100,
      });
      return rows.map((row) => ({ businessId, id: String(row.sequence) }));
    },
    async listDue(): Promise<InboxRef[]> {
      const now = clock();
      const rows = await db.$queryRaw<{ sequence: bigint }[]>`
        SELECT w."sequence" FROM "InboundWork" w JOIN "Message" m ON m.id = w."messageId"
        WHERE w."businessId" = ${businessId}::uuid AND w.state IN ('pending', 'processing')
          AND w."nextAttemptAt" <= ${now} AND (w."leaseUntil" IS NULL OR w."leaseUntil" <= ${now})
          AND NOT EXISTS (SELECT 1 FROM "InboundWork" prior JOIN "Message" pm ON pm.id = prior."messageId"
            WHERE prior."businessId" = ${businessId}::uuid AND prior.state IN ('pending', 'processing')
              AND pm."conversationId" = m."conversationId" AND prior.sequence < w.sequence)
        ORDER BY w.sequence LIMIT 100`;
      return rows.map((row) => ({ businessId, sequence: String(row.sequence) }));
    },
    claim: (sequence: string) => claim(db, businessId, sequence, clock),
    renew: (lease: InboxLease) => mutate(lease, (now) => ({ leaseUntil: leaseUntil(now) })),
    complete: (lease: InboxLease, state: "done" | "skipped", reason: string | null = null) =>
      mutate(lease, (now) => ({ state, reason, finishedAt: now, leaseUntil: null })),
    retryBeforeStart: (lease: InboxLease) => retryBeforeStart(db, { businessId, lease, clock }),
  };
}

async function retryBeforeStart(
  db: Db,
  { businessId, lease, clock }: { businessId: string; lease: InboxLease; clock: Clock },
) {
  await withSlotLock(db, businessId, clock, async (tx, now) => {
    await assertInboxLease(tx, businessId, lease, now);
    const row = await tx.inboundWork.findFirstOrThrow({
      where: { businessId, sequence: inboxId(lease.sequence) },
    });
    const dead = row.attempts >= 5;
    await tx.inboundWork.updateMany({
      where: { businessId, sequence: row.sequence },
      data: {
        state: dead ? "dead" : "pending",
        reason: "pre_start_failure",
        leaseUntil: null,
        finishedAt: dead ? now : null,
        nextAttemptAt: new Date(now.getTime() + Math.min(30_000, 1000 * 2 ** (row.attempts - 1))),
      },
    });
  });
}
