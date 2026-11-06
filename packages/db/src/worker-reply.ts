import type { Tx } from "./client";
import type { AgentScope } from "./agent-context";
import { assertInboxLease, inboxId, LeaseLost } from "./inbox-lease";

export async function leasedInbox(tx: Tx, scope: AgentScope, now: Date) {
  if (!scope.lease || scope.signal?.aborted) throw new LeaseLost();
  await assertInboxLease(tx, scope.businessId, scope.lease, now);
  const row = await tx.inboundWork.findFirst({
    where: {
      businessId: scope.businessId,
      sequence: inboxId(scope.lease.sequence),
      message: {
        conversationId: scope.conversationId,
        conversation: { customerId: scope.customerId },
      },
    },
  });
  if (!row) throw new LeaseLost();
  return row;
}

export async function finishInbox(tx: Tx, scope: AgentScope, now: Date, state: "done" | "skipped") {
  const row = await leasedInbox(tx, scope, now);
  await tx.inboundWork.update({
    where: { businessId: scope.businessId, sequence: row.sequence },
    data: { state, finishedAt: now, leaseUntil: null },
  });
}

export async function queueReply(
  tx: Tx,
  scope: AgentScope,
  now: Date,
  reply: { messageId: string; allowOwner: boolean },
) {
  const row = await leasedInbox(tx, scope, now);
  await tx.outboundWork.create({
    data: {
      businessId: scope.businessId,
      messageId: reply.messageId,
      inboundSequence: row.sequence,
      phoneNumberId: row.phoneNumberId,
      allowOwner: reply.allowOwner,
      createdAt: now,
    },
  });
  await finishInbox(tx, scope, now, "done");
}
