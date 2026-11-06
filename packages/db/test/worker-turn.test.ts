import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createAgentStore,
  createInboxStore,
  createWhatsAppIntake,
  registerWhatsAppNumber,
} from "../src/index";
import { prepareInboxTurn } from "../src/worker-turn";
import { agentFixture, AGENT_NOW } from "./agent-fixture";
import { baseUrl, useTestDatabase } from "./test-db";

const info = { model: "fake", promptVersion: "test", ratesVersion: "test" };
describe.skipIf(!baseUrl)("fenced worker turns", () => {
  const database = useTestDatabase();
  let number = 9000;
  async function setup(kind: "text" | "unsupported" = "text") {
    const db = database.db();
    const fixture = await agentFixture(db);
    const phoneNumberId = String(++number);
    await registerWhatsAppNumber(db, { businessId: fixture.scope.businessId, phoneNumberId });
    let now = AGENT_NOW;
    const clock = () => now;
    const accept = createWhatsAppIntake(db, clock);
    const send = () =>
      accept({
        phoneNumberId,
        providerMessageId: randomUUID(),
        phone: "+12025550180",
        providerTimestamp: now,
        kind,
        body: "Request",
      });
    await send();
    const inbox = createInboxStore(db, fixture.scope.businessId, clock);
    const ref = (await inbox.listDue())[0]!;
    const claim = await inbox.claim(ref.sequence);
    if (claim.state !== "claimed") throw new Error("Expected claim");
    const scope = { ...claim.scope, lease: claim.lease };
    return {
      db,
      input: fixture.input,
      inbox,
      scope,
      clock,
      claim,
      send,
      store: createAgentStore(db, scope, clock),
      advance: () => {
        now = new Date(now.getTime() + 91_000);
      },
    };
  }
  it("commits the run, reply, outbound record and inbox completion together", async () => {
    const { db, scope, store, claim, inbox, clock } = await setup();
    expect(await prepareInboxTurn(db, scope, clock)).toBe("run");
    const run = await store.claim(claim.messageId, info);
    if (run.state !== "claimed") throw new Error("Expected run");
    await store.finish(run.runId, { reply: "Reply", outcome: "replied", latencyMs: 1 });
    expect((await inbox.claim(scope.lease.sequence)).state).toBe("terminal");
    const outbound = await db.outboundWork.findFirstOrThrow({
      where: { businessId: scope.businessId },
      include: { message: true },
    });
    expect(outbound.message.body).toBe("Reply");
    expect(outbound.inboundSequence).toBe(BigInt(scope.lease.sequence));
    await expect(
      store.finish(run.runId, { reply: "Duplicate", outcome: "replied", latencyMs: 1 }),
    ).rejects.toThrow();
    expect(await db.outboundWork.count({ where: { businessId: scope.businessId } })).toBe(1);
  });
  it("fences traces, tools and finish after expiry, including callers omitting the lease", async () => {
    const { db, scope, store, claim, advance, clock } = await setup();
    const run = await store.claim(claim.messageId, info);
    if (run.state !== "claimed") throw new Error("Expected run");
    const unfenced = createAgentStore(db, claim.scope, clock);
    await expect(unfenced.handoff(run.runId, "bad", "bad")).rejects.toThrow("Lease lost");
    advance();
    await expect(store.taskFailure(run.runId, "hold", true)).rejects.toThrow("Lease lost");
    await expect(store.handoff(run.runId, "bad", "bad")).rejects.toThrow("Lease lost");
    await expect(
      store.finish(run.runId, { reply: "Stale", outcome: "replied", latencyMs: 1 }),
    ).rejects.toThrow("Lease lost");
    expect(await db.outboundWork.count({ where: { businessId: scope.businessId } })).toBe(0);
  });
  it("recovers an interrupted run once without repeating its tools", async () => {
    const { db, scope, store, claim, advance, clock, inbox, input } = await setup();
    const run = await store.claim(claim.messageId, info);
    if (run.state !== "claimed") throw new Error("Expected run");
    await store.hold(run.runId, "hold", input);
    const held = await db.hold.findFirstOrThrow({
      where: { businessId: scope.businessId, conversationId: scope.conversationId },
    });
    await store.handoff(run.runId, "tool-handoff", "customer_request");
    advance();
    const next = await inbox.claim(scope.lease.sequence);
    if (next.state !== "claimed") throw new Error("Expected recovery");
    expect(await prepareInboxTurn(db, { ...next.scope, lease: next.lease }, clock)).toBe(
      "finished",
    );
    expect(await db.toolExecution.count({ where: { runId: run.runId } })).toBe(2);
    expect(await db.hold.findUniqueOrThrow({ where: { id: held.id } })).toEqual(held);
    expect(await db.outboundWork.count({ where: { businessId: scope.businessId } })).toBe(1);
    expect((await db.agentRun.findUniqueOrThrow({ where: { id: run.runId } })).outcome).toBe(
      "error",
    );
  });
  it("orders context by processed turns and excludes future queued messages", async () => {
    const { db, scope, store, claim, send, inbox, clock } = await setup();
    await send();
    await send();
    const first = await store.claim(claim.messageId, info);
    if (first.state !== "claimed") throw new Error("Expected run");
    await store.finish(first.runId, { reply: "Earlier reply", outcome: "replied", latencyMs: 1 });
    const next = await inbox.claim((await inbox.listDue())[0]!.sequence);
    if (next.state !== "claimed") throw new Error("Expected next");
    const second = await createAgentStore(db, { ...next.scope, lease: next.lease }, clock).claim(
      next.messageId,
      info,
    );
    if (second.state !== "claimed") throw new Error("Expected run");
    expect(second.snapshot.messages.map((m) => ("text" in m ? m.text : ""))).toEqual([
      "Request",
      "Earlier reply",
      "Request",
    ]);
    expect(scope.businessId).toBe(next.scope.businessId);
  });
  it("answers unsupported input without a model run and skips owner threads", async () => {
    const unsupported = await setup("unsupported");
    expect(await prepareInboxTurn(unsupported.db, unsupported.scope, unsupported.clock)).toBe(
      "finished",
    );
    expect(
      await unsupported.db.agentRun.count({
        where: { conversationId: unsupported.scope.conversationId },
      }),
    ).toBe(0);
    expect(
      await unsupported.db.outboundWork.count({
        where: { businessId: unsupported.scope.businessId },
      }),
    ).toBe(1);
    const owned = await setup();
    await owned.db.conversation.update({
      where: { id: owned.scope.conversationId },
      data: { status: "owner" },
    });
    expect(await prepareInboxTurn(owned.db, owned.scope, owned.clock)).toBe("finished");
    expect(
      await owned.db.outboundWork.count({ where: { businessId: owned.scope.businessId } }),
    ).toBe(0);
  });
  it("rejects forged lease scopes and prevents unfenced claims", async () => {
    const f = await setup();
    const legacy = createAgentStore(f.db, f.claim.scope, f.clock);
    await expect(legacy.claim(f.claim.messageId, info)).rejects.toThrow("Lease lost");
    const other = await setup();
    await expect(
      prepareInboxTurn(
        f.db,
        { ...other.scope, businessId: f.scope.businessId, lease: f.scope.lease },
        f.clock,
      ),
    ).rejects.toThrow("Lease lost");
    await f.send();
    const later = await f.db.inboundWork.findFirstOrThrow({
      where: { businessId: f.scope.businessId, sequence: { gt: BigInt(f.scope.lease.sequence) } },
    });
    await expect(f.store.claim(later.messageId, info)).rejects.toThrow("Lease lost");
    const unqueued = await f.db.message.create({
      data: {
        conversationId: f.scope.conversationId,
        channel: "whatsapp",
        direction: "inbound",
        author: "customer",
        body: "Legacy",
      },
    });
    await expect(f.store.claim(unqueued.id, info)).rejects.toThrow("Lease lost");
    const run = await f.db.agentRun.create({
      data: {
        conversationId: f.scope.conversationId,
        triggerMessageId: unqueued.id,
        model: "fake",
        promptVersion: "test",
      },
    });
    await expect(f.store.handoff(run.id, "bad", "bad")).rejects.toThrow("Lease lost");
  });
  it("recovers fresh interrupted runs but suppresses replies after owner takeover", async () => {
    for (const status of ["agent", "owner", "closed"] as const) {
      const f = await setup();
      const run = await f.store.claim(f.claim.messageId, info);
      if (run.state !== "claimed") throw new Error("Expected run");
      await f.db.conversation.update({ where: { id: f.scope.conversationId }, data: { status } });
      expect(await prepareInboxTurn(f.db, f.scope, f.clock)).toBe("finished");
      expect(await f.db.outboundWork.count({ where: { businessId: f.scope.businessId } })).toBe(
        status === "agent" ? 1 : 0,
      );
    }
  });
  it("blocks tool writes after cancellation even while the lease is live", async () => {
    const f = await setup();
    const controller = new AbortController();
    const store = createAgentStore(f.db, { ...f.scope, signal: controller.signal }, f.clock);
    const run = await store.claim(f.claim.messageId, info);
    if (run.state !== "claimed") throw new Error("Expected run");
    controller.abort();
    await expect(store.hold(run.runId, "late", f.input)).rejects.toThrow("Lease lost");
    expect(await f.db.hold.count({ where: { businessId: f.scope.businessId } })).toBe(0);
    expect(await prepareInboxTurn(f.db, f.scope, f.clock)).toBe("finished");
  });
});
