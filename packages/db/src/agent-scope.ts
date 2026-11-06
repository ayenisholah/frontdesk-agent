import type { Db, Tx } from "./client";

export type AgentScope = { businessId: string; customerId: string; conversationId: string };
function conversationWhere(scope: AgentScope) {
  return {
    id: scope.conversationId,
    businessId: scope.businessId,
    customerId: scope.customerId,
    customer: { businessId: scope.businessId },
  };
}
export async function scopedConversation(db: Db | Tx, scope: AgentScope) {
  const conversation = await db.conversation.findFirst({
    where: conversationWhere(scope),
    include: { business: true, customer: true },
  });
  if (!conversation) throw new Error("Conversation unavailable");
  return conversation;
}
export async function scopedRun(tx: Tx, scope: AgentScope, runId: string) {
  const run = await tx.agentRun.findFirst({
    where: { id: runId, conversation: conversationWhere(scope), finishedAt: null },
  });
  if (!run) throw new Error("Run unavailable");
  return run;
}
