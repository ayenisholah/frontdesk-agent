import type { AgentStore } from "@frontdesk/agent";
import type { Db, Tx } from "./client";
import { createToolStore } from "./agent-tools";
import { scopedRun, type AgentScope } from "./agent-scope";
import { claimTurn } from "./agent-claim";
import { finishRun, recordStep, recordUsage, taskFailure } from "./agent-traces";
import { withSlotLock, type Clock } from "./slots";

export function createAgentStore(db: Db, scope: AgentScope, clock: Clock): AgentStore {
  const withRun = <T>(runId: string, work: (tx: Tx, now: Date) => Promise<T>) =>
    withSlotLock(db, scope.businessId, clock, async (tx, now) => {
      await scopedRun(tx, scope, runId);
      return work(tx, now);
    });
  return {
    ...createToolStore(db, scope, clock),
    claim: (messageId, info) => claimTurn(db, { scope, clock }, messageId, info),
    recordUsage: (runId, usage) => withRun(runId, (tx) => recordUsage(tx, runId, usage)),
    recordStep: (runId, index, step) => withRun(runId, (tx) => recordStep(tx, runId, index, step)),
    taskFailure: (runId, task, failed) =>
      withRun(runId, (tx) => taskFailure(tx, scope.conversationId, task, failed)),
    finish: (runId, result) =>
      withRun(runId, (tx, now) => finishRun(tx, { scope, now, runId }, result)),
  };
}
