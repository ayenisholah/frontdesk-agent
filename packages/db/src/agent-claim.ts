import type { ClaimResult, RunInfo } from "@frontdesk/agent";
import { leasedInbox } from "./worker-reply";
import { LeaseLost } from "./inbox-lease";
import type { Db, Tx } from "./client";
import { scopedConversation, type AgentScope } from "./agent-scope";
import { loadSnapshot } from "./agent-snapshot";
import { withSlotLock, type Clock } from "./slots";

export function claimTurn(
  db: Db,
  context: { scope: AgentScope; clock: Clock },
  messageId: string,
  info: RunInfo,
): Promise<ClaimResult> {
  const { scope, clock } = context;
  return withSlotLock(db, scope.businessId, clock, async (tx, now) => {
    const conversation = await scopedConversation(tx, scope);
    const message = await tx.message.findFirst({
      where: {
        id: messageId,
        conversationId: scope.conversationId,
        author: "customer",
        direction: "inbound",
        conversation: { businessId: scope.businessId },
      },
    });
    if (!message) throw new Error("Message unavailable");
    if (message.redactedAt) return { state: "silent" };
    const work = await claimInbox(tx, scope, messageId, now);
    if (conversation.status !== "agent") return { state: "silent" };
    const existing = await tx.agentRun.findUnique({
      where: {
        conversationId_triggerMessageId: {
          conversationId: scope.conversationId,
          triggerMessageId: messageId,
        },
      },
    });
    if (existing)
      return existing.finishedAt && existing.reply
        ? { state: "replay", reply: existing.reply }
        : { state: "busy" };
    const pending = await tx.agentRun.findFirst({
      where: { conversationId: scope.conversationId, finishedAt: null },
    });
    if (pending) return { state: "busy" };
    const run = await tx.agentRun.create({
      data: {
        ...info,
        inboxSequence: work?.sequence,
        conversationId: scope.conversationId,
        triggerMessageId: messageId,
        startedAt: now,
      },
    });
    return {
      state: "claimed",
      runId: run.id,
      snapshot: await loadSnapshot(tx, scope, message, now),
    };
  });
}

async function claimInbox(tx: Tx, scope: AgentScope, messageId: string, now: Date) {
  const work = await tx.inboundWork.findFirst({
    where: { businessId: scope.businessId, messageId },
  });
  if (work) {
    const leased = await leasedInbox(tx, scope, now);
    if (leased.messageId !== messageId) throw new LeaseLost();
  } else if (scope.lease) throw new LeaseLost();
  return work;
}
