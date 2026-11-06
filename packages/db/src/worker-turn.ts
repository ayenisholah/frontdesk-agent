import { HANDOFF_REPLY } from "@frontdesk/agent";
import type { Db, Tx } from "./client";
import { scopedConversation, type AgentScope } from "./agent-scope";
import { withSlotLock, type Clock } from "./slots";
import { leasedInbox, finishInbox, queueReply } from "./worker-reply";

const UNSUPPORTED_REPLY = "I can help with text messages. Please type your request.";

/** Recover interrupted turns without replaying models or booking side effects. */
export function prepareInboxTurn(db: Db, scope: AgentScope, clock: Clock) {
  return withSlotLock(db, scope.businessId, clock, async (tx, now) => {
    const work = await leasedInbox(tx, scope, now);
    const conversation = await scopedConversation(tx, scope);
    const run = await tx.agentRun.findFirst({
      where: {
        conversationId: scope.conversationId,
        triggerMessageId: work.messageId,
        conversation: { businessId: scope.businessId },
      },
    });
    if (run) {
      const ownHandoff = await tx.toolExecution.findFirst({
        where: { runId: run.id, signature: { startsWith: '["handoff",' } },
      });
      const canReply =
        conversation.status === "agent" || (conversation.status === "owner" && Boolean(ownHandoff));
      await tx.agentRun.update({
        where: { id: run.id },
        data: {
          finishedAt: now,
          outcome: "error",
          reply: canReply ? HANDOFF_REPLY : null,
        },
      });
      if (canReply) {
        await tx.conversation.update({
          where: { id: scope.conversationId, businessId: scope.businessId },
          data: { status: "owner", handoffReason: "interrupted_turn" },
        });
        await reply(tx, scope, now, { body: HANDOFF_REPLY, allowOwner: true });
      } else await finishInbox(tx, scope, now, "skipped");
      return "finished" as const;
    }
    if (conversation.status !== "agent") {
      await finishInbox(tx, scope, now, "skipped");
      return "finished" as const;
    }
    if (work.kind === "unsupported") {
      await reply(tx, scope, now, { body: UNSUPPORTED_REPLY, allowOwner: false });
      return "finished" as const;
    }
    return "run" as const;
  });
}

async function reply(
  tx: Tx,
  scope: AgentScope,
  now: Date,
  content: { body: string; allowOwner: boolean },
) {
  const message = await tx.message.create({
    data: {
      conversationId: scope.conversationId,
      channel: "whatsapp",
      direction: "outbound",
      author: "agent",
      body: content.body,
      createdAt: now,
    },
  });
  await queueReply(tx, scope, now, { messageId: message.id, allowOwner: content.allowOwner });
}
