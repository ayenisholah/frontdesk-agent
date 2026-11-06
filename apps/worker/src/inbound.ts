import type { InboxClaim, InboxLease, InboxRef } from "@frontdesk/db";

type Claimed = Extract<InboxClaim, { state: "claimed" }>;
type Inbox = {
  claim(sequence: string): Promise<InboxClaim>;
  renew(lease: InboxLease): Promise<void>;
  complete(lease: InboxLease, state: "skipped", reason: string): Promise<void>;
  retryBeforeStart(lease: InboxLease): Promise<void>;
};
type Dependencies = {
  inbox(businessId: string): Inbox;
  prepare(claim: Claimed): Promise<"run" | "finished">;
  execute(claim: Claimed, signal: AbortSignal): Promise<{ state: string }>;
  report(): void;
  shutdownSignal?: AbortSignal;
};

export function createInboundProcessor(deps: Dependencies) {
  return async (ref: InboxRef) => {
    const inbox = deps.inbox(ref.businessId);
    const claim = await inbox.claim(ref.sequence);
    if (claim.state !== "claimed") return;
    const controller = new AbortController();
    let renewing = Promise.resolve();
    const heartbeat = setInterval(() => {
      renewing = renewing
        .then(() => inbox.renew(claim.lease))
        .catch(() => {
          controller.abort();
          deps.report();
        });
    }, 20_000);
    const deadline = setTimeout(() => controller.abort(), 300_000);
    try {
      if ((await deps.prepare(claim)) === "finished") return;
      const signal = deps.shutdownSignal
        ? AbortSignal.any([controller.signal, deps.shutdownSignal])
        : controller.signal;
      const result = await deps.execute(claim, signal);
      if (result.state === "silent") await inbox.complete(claim.lease, "skipped", "owner");
      if (result.state === "busy") throw new Error("Turn unavailable");
    } catch {
      // Inspect durable state first: retrying is safe only before an AgentRun exists.
      if ((await deps.prepare(claim)) === "run") await inbox.retryBeforeStart(claim.lease);
    } finally {
      clearInterval(heartbeat);
      clearTimeout(deadline);
      await renewing;
    }
  };
}
