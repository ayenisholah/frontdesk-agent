import { describe, expect, it } from "vitest";
import { createToolStore } from "../src/index";
import { AGENT_NOW, agentFixture } from "./agent-fixture";
import { baseUrl, useTestDatabase } from "./test-db";

describe.skipIf(!baseUrl)("agent tool store", () => {
  const database = useTestDatabase();
  const setup = async () => {
    const db = database.db();
    const fixture = await agentFixture(db);
    return { db, ...fixture, store: createToolStore(db, fixture.scope, () => AGENT_NOW) };
  };
  it("queries current availability and holds a real slot exactly once", async () => {
    const { db, store, input, runId } = await setup();
    const query = {
      serviceKey: input.serviceKey,
      from: "2031-03-03T09:00:00Z",
      to: "2031-03-03T17:00:00Z",
    };
    expect((await store.availability(query)).length).toBeGreaterThan(0);
    const [first, replay] = await Promise.all([
      store.hold(runId, "one", input),
      store.hold(runId, "one", input),
    ]);
    expect(first).toEqual(replay);
    expect(first.ok).toBe(true);
    expect(await db.toolExecution.count({ where: { runId } })).toBe(1);
    await expect(
      store.hold(runId, "one", { ...input, startsAt: "2031-03-03T11:00:00Z" }),
    ).rejects.toThrow("Execution key reused");
    expect(
      (await store.hold(runId, "bad", { ...input, startsAt: "2031-03-03T10:07:00Z" })).ok,
    ).toBe(false);
    expect(await store.availability({ ...query, serviceKey: "missing" })).toEqual([]);
  });
  it("does not extend a replayed hold", async () => {
    const { db, store, scope, runId, input } = await setup();
    const first = await store.hold(runId, "one", input);
    const later = createToolStore(db, scope, () => new Date(AGENT_NOW.getTime() + 60_000));
    expect(await later.hold(runId, "one", input)).toEqual(first);
  });
  it("persists handoff once and refuses further side effects", async () => {
    const { db, scope, store, runId, input } = await setup();
    await store.handoff(runId, "owner", "refund");
    await store.handoff(runId, "owner", "refund");
    expect(await db.conversation.findUnique({ where: { id: scope.conversationId } })).toMatchObject(
      { status: "owner", handoffReason: "refund" },
    );
    await expect(store.hold(runId, "late", input)).rejects.toThrow("Conversation unavailable");
  });
  it("scopes reads and mutations to the trusted tenant, customer, conversation and run", async () => {
    const { db, scope, store, runId, input } = await setup();
    const other = await agentFixture(db);
    const foreign = createToolStore(
      db,
      { ...scope, businessId: other.scope.businessId },
      () => AGENT_NOW,
    );
    await expect(
      foreign.availability({
        serviceKey: input.serviceKey,
        from: AGENT_NOW.toISOString(),
        to: "2031-03-04T08:00:00Z",
      }),
    ).rejects.toThrow("Conversation unavailable");
    await expect(foreign.hold(runId, "x", input)).rejects.toThrow();
    await expect(store.hold(other.runId, "x", input)).rejects.toThrow();
    await db.agentRun.update({ where: { id: runId }, data: { finishedAt: AGENT_NOW } });
    await expect(store.hold(runId, "x", input)).rejects.toThrow();
  });
});
