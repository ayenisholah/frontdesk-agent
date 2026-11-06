import type { HoldInput, StoredHold, ToolStore } from "@frontdesk/agent";
import type { Db, Tx } from "./client";
import type { Prisma } from "./generated/client";
import { scopedConversation, scopedRun, type AgentScope } from "./agent-scope";
import { agentAvailability } from "./agent-availability";
import { placeHoldInTransaction } from "./holds";
import { withSlotLock, type Clock } from "./slots";

type Execution = { runId: string; callId: string; signature: string };
function mutate<T>(
  dependencies: { db: Db; scope: AgentScope; clock: Clock },
  execution: Execution,
  work: (tx: Tx, now: Date) => Promise<T>,
): Promise<T> {
  const { db, scope, clock } = dependencies;
  return withSlotLock(db, scope.businessId, clock, async (tx, now) => {
    await scopedRun(tx, scope, execution.runId, now);
    const previous = await tx.toolExecution.findUnique({
      where: { runId_callId: { runId: execution.runId, callId: execution.callId } },
    });
    if (previous) {
      if (previous.signature !== execution.signature) throw new Error("Execution key reused");
      return previous.result as T;
    }
    const conversation = await scopedConversation(tx, scope);
    if (conversation.status !== "agent") throw new Error("Conversation unavailable");
    const result = await work(tx, now);
    await tx.toolExecution.create({
      data: { ...execution, result: result as Prisma.InputJsonValue },
    });
    return result;
  });
}

async function hold(tx: Tx, scope: AgentScope, input: HoldInput, now: Date): Promise<StoredHold> {
  const result = await placeHoldInTransaction(
    tx,
    { ...scope, ...input, startsAt: new Date(input.startsAt) },
    now,
  );
  if (!result.ok) return result;
  const h = result.hold;
  return {
    ok: true,
    hold: {
      id: h.id,
      startsAt: h.startsAt.toISOString(),
      endsAt: h.endsAt.toISOString(),
      expiresAt: h.expiresAt.toISOString(),
    },
  };
}

export function createToolStore(db: Db, scope: AgentScope, clock: Clock): ToolStore {
  return {
    availability: (input) => agentAvailability(db, scope, clock, input),
    hold: (runId, callId, input) =>
      mutate(
        { db, scope, clock },
        { runId, callId, signature: JSON.stringify(["hold", input.serviceKey, input.startsAt]) },
        (tx, now) => hold(tx, scope, input, now),
      ),
    async handoff(runId, callId, reason) {
      await mutate(
        { db, scope, clock },
        { runId, callId, signature: JSON.stringify(["handoff", reason]) },
        async (tx) => {
          await tx.conversation.update({
            where: { id: scope.conversationId, businessId: scope.businessId },
            data: { status: "owner", handoffReason: reason },
          });
          return { handedOff: true };
        },
      );
    },
  };
}
