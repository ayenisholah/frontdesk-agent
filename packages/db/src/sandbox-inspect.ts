import type { EvaluationState } from "@frontdesk/agent";
import type { Db } from "./client";
import { scopedConversation, type AgentScope } from "./agent-scope";
import type { Clock } from "./slots";

export async function inspectSandbox(
  db: Db,
  scope: AgentScope,
  clock: Clock,
): Promise<EvaluationState> {
  const conversation = await scopedConversation(db, scope);
  const holds = await db.hold.findMany({
    where: {
      businessId: scope.businessId,
      conversationId: scope.conversationId,
      status: "active",
      expiresAt: { gt: clock() },
    },
  });
  const runs = await db.agentRun.findMany({
    where: { conversationId: scope.conversationId, conversation: { businessId: scope.businessId } },
    include: { steps: true, usage: true },
  });
  const confirmedBookings = await db.booking.count({
    where: { businessId: scope.businessId, customerId: scope.customerId, status: "confirmed" },
  });
  return {
    activeHolds: holds.length,
    owner: conversation.status === "owner",
    startsAt: holds[0]?.startsAt.toISOString() ?? null,
    confirmedBookings,
    runs: runs.length,
    completeRuns: runs.filter((r) => r.finishedAt && r.outcome && r.steps.length && r.usage.length)
      .length,
    costMicros: runs.reduce((sum, r) => sum + r.costMicros, 0),
  };
}
