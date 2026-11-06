import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createInboxStore, createWhatsAppIntake, registerWhatsAppNumber } from "@frontdesk/db";
import { agentFixture, AGENT_NOW } from "../../../packages/db/test/agent-fixture";
import { baseUrl, useTestDatabase } from "../../../packages/db/test/test-db";
import { createQueues } from "../src/queues";
import { dispatchInbox } from "../src/dispatch";

const redis = process.env.REDIS_URL;
describe.skipIf(!baseUrl || !redis)("inbox queue reconciliation", () => {
  const database = useTestDatabase();
  it("rebuilds lost jobs and processes conversations concurrently in sequence order", async () => {
    const db = database.db();
    const { scope } = await agentFixture(db);
    await registerWhatsAppNumber(db, { businessId: scope.businessId, phoneNumberId: "8080" });
    const accept = createWhatsAppIntake(db, () => AGENT_NOW);
    for (const phone of ["+12025550100", "+12025550100", "+12025550100", "+12025550101"])
      await accept({
        phoneNumberId: "8080",
        providerMessageId: randomUUID(),
        phone,
        providerTimestamp: AGENT_NOW,
        kind: "text",
        body: "Fictional request",
      });
    const store = createInboxStore(db, scope.businessId, () => AGENT_NOW);
    const queues = createQueues({ url: redis!, prefix: `test-${randomUUID()}`, report: () => {} });
    const started: string[] = [];
    const completed: string[] = [];
    let release!: () => void;
    const gate = {
      promise: new Promise<void>((resolve) => {
        release = resolve;
      }),
      resolve: () => release(),
    };
    try {
      await queues.inbound.waitUntilReady();
      expect(await dispatchInbox(store, queues.inbound)).toBe(2);
      await queues.inbound.obliterate({ force: true });
      expect(await dispatchInbox(store, queues.inbound)).toBe(2);
      const process = async ({ sequence }: { sequence: string }) => {
        const claim = await store.claim(sequence);
        if (claim.state !== "claimed") return;
        started.push(sequence);
        await gate.promise;
        await store.complete(claim.lease, "done");
        completed.push(sequence);
      };
      queues.worker(process);
      queues.worker(process);
      await vi.waitFor(() => expect(started).toHaveLength(2), { timeout: 5000 });
      expect(await store.listDue()).toHaveLength(0);
      gate.resolve();
      await vi.waitFor(() => expect(completed).toHaveLength(2), { timeout: 5000 });
      expect(await dispatchInbox(store, queues.inbound)).toBe(1);
      await vi.waitFor(() => expect(completed).toHaveLength(3), { timeout: 5000 });
      expect(await dispatchInbox(store, queues.inbound)).toBe(1);
      await vi.waitFor(() => expect(completed).toHaveLength(4), { timeout: 5000 });
      expect(await store.listDue()).toHaveLength(0);
      const ordered = await db.inboundWork.findMany({
        where: { businessId: scope.businessId },
        orderBy: { sequence: "asc" },
      });
      const sameConversation = ordered.slice(0, 3).map((r) => String(r.sequence));
      expect(started.filter((id) => sameConversation.includes(id))).toEqual(sameConversation);
    } finally {
      gate.resolve();
      await queues.close();
      // Queue jobs remove themselves after success; remove this isolated namespace metadata too.
      const cleanup = createQueues({
        url: redis!,
        prefix: queues.inbound.opts.prefix!,
        report: () => {},
      });
      await cleanup.inbound.waitUntilReady();
      await Promise.all([
        cleanup.inbound.obliterate({ force: true }),
        cleanup.outbound.obliterate({ force: true }),
        cleanup.dead.obliterate({ force: true }),
      ]);
      await cleanup.close();
    }
  }, 20_000);
});
