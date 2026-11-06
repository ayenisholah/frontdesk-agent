import { describe, expect, it } from "vitest";
import { createAgentStore, placeHold, bookFromHold } from "../src/index";
import { AGENT_NOW, agentFixture } from "./agent-fixture";
import { baseUrl, useTestDatabase } from "./test-db";

const info = { model: "eu.main", promptVersion: "test", ratesVersion: "test" };
describe.skipIf(!baseUrl)("conversation and trace store", () => {
  const database = useTestDatabase();
  const setup = async () => {
    const db = database.db();
    const f = await agentFixture(db);
    await db.agentRun.delete({ where: { id: f.runId } });
    return { db, ...f, store: createAgentStore(db, f.scope, () => AGENT_NOW) };
  };
  it("claims a message once under concurrency and replays its completed reply", async () => {
    const { db, store, messageId, scope } = await setup();
    const claims = await Promise.all([store.claim(messageId, info), store.claim(messageId, info)]);
    expect(claims.map((c) => c.state).sort()).toEqual(["busy", "claimed"]);
    const claim = claims.find((c) => c.state === "claimed")!;
    if (claim.state !== "claimed") throw new Error("Expected claimed");
    expect(claim.snapshot.messages).toHaveLength(1);
    expect(claim.snapshot.activeHold).toBeNull();
    expect(claim.snapshot.booking).toBeNull();
    await store.recordUsage(claim.runId, {
      modelId: "eu.main",
      usage: { inputTokens: 10, outputTokens: 5 },
      costMicros: 105,
      ratesVersion: "test",
    });
    await store.recordStep(claim.runId, 0, {
      call: { id: "c", name: "get_services", input: {} },
      result: { toolCallId: "c", content: { reply: "Services" }, isError: false },
      latencyMs: 3,
    });
    await store.finish(claim.runId, { reply: "Services", outcome: "replied", latencyMs: 20 });
    expect(await store.claim(messageId, info)).toEqual({ state: "replay", reply: "Services" });
    const run = await db.agentRun.findUniqueOrThrow({
      where: { id: claim.runId },
      include: { steps: true, usage: true },
    });
    expect(run).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
      costMicros: 105,
      outcome: "replied",
    });
    expect(run.steps).toHaveLength(1);
    expect(run.usage).toHaveLength(1);
    expect(
      await db.message.count({ where: { conversationId: scope.conversationId, author: "agent" } }),
    ).toBe(1);
    await expect(
      store.finish(claim.runId, { reply: "Again", outcome: "replied", latencyMs: 0 }),
    ).rejects.toThrow();
  });
  it("blocks overlapping turns and skips owner-controlled or closed conversations", async () => {
    const { db, scope, store, messageId } = await setup();
    await store.claim(messageId, info);
    const next = await db.message.create({
      data: {
        conversationId: scope.conversationId,
        direction: "inbound",
        author: "customer",
        channel: "whatsapp",
        body: "Next",
      },
    });
    expect((await store.claim(next.id, info)).state).toBe("busy");
    for (const status of ["owner", "closed"] as const) {
      await db.conversation.update({ where: { id: scope.conversationId }, data: { status } });
      expect((await store.claim(next.id, info)).state).toBe("silent");
    }
  });
  it("persists task failures across runs and resets on success", async () => {
    const { store, messageId } = await setup();
    const claim = await store.claim(messageId, info);
    if (claim.state !== "claimed") throw new Error("Expected claimed");
    expect(await store.taskFailure(claim.runId, "hold_slot", true)).toBe(1);
    expect(await store.taskFailure(claim.runId, "hold_slot", true)).toBe(2);
    expect(await store.taskFailure(claim.runId, "hold_slot", false)).toBe(0);
    expect(await store.taskFailure(claim.runId, "hold_slot", true)).toBe(1);
    await store.recordStep(claim.runId, 0, {
      call: { id: "bad", name: "bad", input: null },
      result: { toolCallId: "bad", content: undefined, isError: true },
      latencyMs: 1,
    });
    await store.handoff(claim.runId, "system-handoff", "repeated_failure");
    await store.finish(claim.runId, {
      reply: "Owner will reply",
      handoff: "repeated_failure",
      outcome: "handoff",
      latencyMs: 1,
    });
  });
  it("refuses foreign messages, runs and customer identities", async () => {
    const { db, scope, messageId, store } = await setup();
    const other = await agentFixture(db);
    await expect(store.claim(other.messageId, info)).rejects.toThrow("Message unavailable");
    const foreign = createAgentStore(
      db,
      { ...scope, customerId: other.scope.customerId },
      () => AGENT_NOW,
    );
    await expect(foreign.claim(messageId, info)).rejects.toThrow("Conversation unavailable");
    await expect(
      store.recordUsage(other.runId, {
        modelId: "fake",
        usage: { inputTokens: 1, outputTokens: 1 },
        costMicros: 1,
        ratesVersion: "test",
      }),
    ).rejects.toThrow("Run unavailable");
  });
  it("loads hold/booking state and bounded history, excluding future messages", async () => {
    const { db, scope, input, store } = await setup();
    const held = await placeHold(db, {
      ...scope,
      ...input,
      startsAt: new Date(input.startsAt),
      clock: () => AGENT_NOW,
    });
    if (!held.ok) throw new Error("Expected hold");
    const base = AGENT_NOW.getTime();
    await db.message.createMany({
      data: Array.from({ length: 24 }, (_, i) => ({
        conversationId: scope.conversationId,
        direction: "inbound" as const,
        author: "customer" as const,
        channel: "whatsapp" as const,
        body: `message ${i}`,
        createdAt: new Date(base + i * 1000),
      })),
    });
    const trigger = await db.message.findFirstOrThrow({
      where: { conversationId: scope.conversationId, body: "message 22" },
    });
    const claim = await store.claim(trigger.id, info);
    if (claim.state !== "claimed") throw new Error("Expected claimed");
    expect(claim.snapshot.messages).toHaveLength(20);
    expect(claim.snapshot.messages.at(-1)).toMatchObject({ text: "message 22" });
    expect(claim.snapshot.activeHold?.serviceKey).toBe(input.serviceKey);
    await store.finish(claim.runId, { reply: "Held", outcome: "replied", latencyMs: 1 });
    await bookFromHold(db, {
      businessId: scope.businessId,
      holdId: held.hold.id,
      clock: () => AGENT_NOW,
    });
    const next = await db.message.findFirstOrThrow({
      where: { conversationId: scope.conversationId, body: "message 23" },
    });
    const booked = await store.claim(next.id, info);
    if (booked.state !== "claimed") throw new Error("Expected claimed");
    expect(booked.snapshot.booking?.status).toBe("pending_deposit");
  });
  it("refuses to publish when ownership changes during inference", async () => {
    const { db, scope, store, messageId } = await setup();
    const claim = await store.claim(messageId, info);
    if (claim.state !== "claimed") throw new Error("Expected claimed");
    await db.conversation.update({
      where: { id: scope.conversationId },
      data: { status: "owner" },
    });
    const finish = { reply: "No", outcome: "replied" as const, latencyMs: 1 };
    await expect(store.finish(claim.runId, finish)).rejects.toThrow("ownership changed");
    await expect(store.finish(claim.runId, { ...finish, handoff: "refund" })).rejects.toThrow(
      "ownership changed",
    );
    expect(
      await db.message.count({ where: { conversationId: scope.conversationId, author: "agent" } }),
    ).toBe(0);
  });
  it("keeps incomplete legacy runs blocked and reconstructs assistant context", async () => {
    const { db, scope, store, messageId } = await setup();
    const trigger = await db.message.findUniqueOrThrow({ where: { id: messageId } });
    await db.message.create({
      data: {
        conversationId: scope.conversationId,
        direction: "outbound",
        author: "agent",
        channel: "whatsapp",
        body: "Earlier",
        createdAt: new Date(trigger.createdAt.getTime() - 1),
      },
    });
    const claim = await store.claim(messageId, info);
    if (claim.state !== "claimed") throw new Error("Expected claimed");
    expect(claim.snapshot.messages[0]?.role).toBe("user");
    await db.agentRun.update({ where: { id: claim.runId }, data: { finishedAt: AGENT_NOW } });
    expect((await store.claim(messageId, info)).state).toBe("busy");
  });
});
