import { describe, expect, it } from "vitest";
import { placeHold, openSandbox, appendSandboxMessage, inspectSandbox } from "../src/index";
import { AGENT_NOW, agentFixture } from "./agent-fixture";
import { baseUrl, useTestDatabase } from "./test-db";

describe.skipIf(!baseUrl)("fictional chat sandbox", () => {
  const database = useTestDatabase();
  it("creates and resumes a fictional session and persists input", async () => {
    const db = database.db();
    const scope = await openSandbox(db, { fixture: "harbor-paws", name: "cli-test" });
    expect(
      await openSandbox(db, {
        fixture: "harbor-paws",
        name: "cli-test",
        conversationId: scope.conversationId,
      }),
    ).toEqual(scope);
    const id = await appendSandboxMessage(db, scope, " Hello ", () => AGENT_NOW);
    expect(await db.message.findUnique({ where: { id } })).toMatchObject({ body: "Hello" });
    expect(await inspectSandbox(db, scope, () => AGENT_NOW)).toMatchObject({
      activeHolds: 0,
      owner: false,
      runs: 0,
      startsAt: null,
    });
    await expect(appendSandboxMessage(db, scope, " ", () => AGENT_NOW)).rejects.toThrow(
      "Invalid message",
    );
    await expect(
      appendSandboxMessage(db, scope, "x".repeat(5001), () => AGENT_NOW),
    ).rejects.toThrow("Invalid message");
  });
  it("refuses unknown fixtures, namespaces and non-sandbox conversations", async () => {
    const db = database.db();
    const other = await agentFixture(db);
    await expect(openSandbox(db, { fixture: "unknown", name: "cli-test" })).rejects.toThrow(
      "Unknown fixture",
    );
    await expect(openSandbox(db, { fixture: "harbor-paws", name: "production" })).rejects.toThrow(
      "Invalid sandbox name",
    );
    await expect(
      openSandbox(db, {
        fixture: "harbor-paws",
        name: "cli-test",
        conversationId: other.scope.conversationId,
      }),
    ).rejects.toThrow("Sandbox unavailable");
    await expect(appendSandboxMessage(db, other.scope, "Hi", () => AGENT_NOW)).rejects.toThrow(
      "Sandbox unavailable",
    );
  });
  it("counts a run complete only with its outcome, steps and usage persisted", async () => {
    const db = database.db();
    const scope = await openSandbox(db, { fixture: "harbor-paws", name: "eval-traces" });
    await placeHold(db, {
      ...scope,
      serviceKey: "bath-short-coat",
      startsAt: new Date("2031-03-03T15:00:00Z"),
      clock: () => AGENT_NOW,
    });
    const run = await db.agentRun.create({
      data: { conversationId: scope.conversationId, model: "fake", promptVersion: "test" },
    });
    const inspect = () => inspectSandbox(db, scope, () => AGENT_NOW);
    expect(await inspect()).toMatchObject({
      activeHolds: 1,
      startsAt: "2031-03-03T15:00:00.000Z",
      completeRuns: 0,
    });
    await db.agentRun.update({ where: { id: run.id }, data: { finishedAt: AGENT_NOW } });
    expect((await inspect()).completeRuns).toBe(0);
    await db.agentRun.update({ where: { id: run.id }, data: { outcome: "replied" } });
    expect((await inspect()).completeRuns).toBe(0);
    await db.agentStep.create({ data: { runId: run.id, index: 0, tool: "classify", input: {} } });
    expect((await inspect()).completeRuns).toBe(0);
    await db.agentUsage.create({
      data: {
        runId: run.id,
        modelId: "fake",
        inputTokens: 1,
        outputTokens: 1,
        costMicros: 2,
        ratesVersion: "test",
      },
    });
    expect((await inspect()).completeRuns).toBe(1);
  });
});
