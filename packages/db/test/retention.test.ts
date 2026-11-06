import { randomUUID, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createInboxStore,
  createAgentStore,
  createWhatsAppStatusIntake,
  placeHold,
  bookFromHold,
  createWhatsAppIntake,
  registerWhatsAppNumber,
  createDeliveryStore,
  prepareInboxTurn,
} from "../src/index";
import { redactBusinessContent } from "../src/retention";
import { agentFixture, AGENT_NOW } from "./agent-fixture";
import { baseUrl, useTestDatabase } from "./test-db";
const DAY = 86400000;

describe.skipIf(!baseUrl)("content retention", () => {
  const database = useTestDatabase();
  let number = 12000;
  async function setup() {
    const db = database.db();
    const f = await agentFixture(db);
    const phoneNumberId = String(++number);
    const old = new Date(AGENT_NOW.getTime() - 91 * DAY);
    const providerMessageId = randomUUID();
    await registerWhatsAppNumber(db, { businessId: f.scope.businessId, phoneNumberId });
    await db.message.update({
      where: { id: f.messageId },
      data: { providerMessageId, createdAt: old },
    });
    const inbox = await db.inboundWork.create({
      data: {
        businessId: f.scope.businessId,
        messageId: f.messageId,
        phoneNumberId,
        kind: "text",
        providerTimestamp: old,
        receivedAt: old,
        nextAttemptAt: old,
      },
    });
    await db.agentRun.update({
      where: { id: f.runId },
      data: {
        startedAt: old,
        finishedAt: old,
        outcome: "replied",
        reply: "Private fictional reply",
        inputTokens: 12,
        inboxSequence: inbox.sequence,
      },
    });
    await db.agentStep.create({
      data: {
        runId: f.runId,
        index: 0,
        tool: "test",
        input: { text: "Private input" },
        output: { text: "Private output" },
      },
    });
    await db.toolExecution.create({
      data: {
        runId: f.runId,
        callId: "call",
        signature: "Private signature",
        result: { text: "Private result" },
      },
    });
    return { db, ...f, inbox, phoneNumberId, providerMessageId, old };
  }
  it("redacts bodies and trace payloads while preserving metadata and dedupe tombstones", async () => {
    const f = await setup();
    const result = await redactBusinessContent(f.db, f.scope.businessId, {
      clock: () => AGENT_NOW,
    });
    expect(result).toEqual({ messages: 1, runs: 1 });
    expect((await f.db.message.findUniqueOrThrow({ where: { id: f.messageId } })).body).toBe(
      "[redacted]",
    );
    const run = await f.db.agentRun.findUniqueOrThrow({
      where: { id: f.runId },
      include: { steps: true, executions: true },
    });
    expect(run).toMatchObject({ reply: null, inputTokens: 12, outcome: "replied" });
    expect(run.steps[0]).toMatchObject({ input: null, output: null });
    expect(run.executions[0]).toMatchObject({ signature: "[redacted]", result: null });
    const accept = createWhatsAppIntake(f.db, () => AGENT_NOW);
    expect(
      await accept({
        phoneNumberId: f.phoneNumberId,
        providerMessageId: f.providerMessageId,
        phone: "+15550001000",
        providerTimestamp: f.old,
        kind: "text",
        body: "Different redelivered body",
      }),
    ).toBe("duplicate");
    expect(
      (
        await createInboxStore(f.db, f.scope.businessId, () => AGENT_NOW).claim(
          String(f.inbox.sequence),
        )
      ).state,
    ).toBe("terminal");
    expect(
      await redactBusinessContent(f.db, f.scope.businessId, { clock: () => AGENT_NOW }),
    ).toEqual({ messages: 0, runs: 0 });
  });
  it("skips active leases, then redacts expired unfinished runs without replaying them", async () => {
    const f = await setup();
    await f.db.agentRun.update({
      where: { id: f.runId },
      data: { finishedAt: null, outcome: null },
    });
    await f.db.inboundWork.update({
      where: { sequence: f.inbox.sequence },
      data: {
        state: "processing",
        leaseToken: 1,
        leaseUntil: new Date(AGENT_NOW.getTime() + 90000),
      },
    });
    expect(
      await redactBusinessContent(f.db, f.scope.businessId, { clock: () => AGENT_NOW }),
    ).toEqual({ messages: 0, runs: 0 });
    const later = new Date(AGENT_NOW.getTime() + 91000);
    expect(await redactBusinessContent(f.db, f.scope.businessId, { clock: () => later })).toEqual({
      messages: 1,
      runs: 1,
    });
    expect((await f.db.agentRun.findUniqueOrThrow({ where: { id: f.runId } })).outcome).toBe(
      "error",
    );
    expect(
      (await f.db.conversation.findUniqueOrThrow({ where: { id: f.scope.conversationId } })).status,
    ).toBe("owner");
  });
  it("blocks expired pending claims and delivery before cleanup runs", async () => {
    const f = await setup();
    const inbox = createInboxStore(f.db, f.scope.businessId, () => AGENT_NOW);
    expect((await inbox.claim(String(f.inbox.sequence))).state).toBe("terminal");
    await f.db.agentRun.delete({ where: { id: f.runId } });
    await f.db.inboundWork.update({
      where: { sequence: f.inbox.sequence },
      data: { state: "pending", kind: "unsupported", leaseUntil: null, finishedAt: null },
    });
    const oldInbox = createInboxStore(f.db, f.scope.businessId, () => f.old);
    const claim = await oldInbox.claim(String(f.inbox.sequence));
    if (claim.state !== "claimed") throw new Error("Expected old claim");
    await prepareInboxTurn(f.db, { ...claim.scope, lease: claim.lease }, () => f.old);
    const work = await f.db.outboundWork.findFirstOrThrow({
      where: { businessId: f.scope.businessId },
    });
    expect(
      (await createDeliveryStore(f.db, f.scope.businessId, () => AGENT_NOW).begin(work.id)).state,
    ).toBe("skip");
    expect((await f.db.outboundWork.findUniqueOrThrow({ where: { id: work.id } })).reason).toBe(
      "content_expired",
    );
    expect(await f.db.deliveryAttempt.count({ where: { outboundId: work.id } })).toBe(0);
  });
  it("respects tenant isolation, custom retention and bounded batches", async () => {
    const f = await setup();
    const other = await setup();
    await f.db.message.create({
      data: {
        conversationId: f.scope.conversationId,
        channel: "whatsapp",
        direction: "inbound",
        author: "customer",
        body: "Another",
        createdAt: f.old,
      },
    });
    expect(
      await redactBusinessContent(f.db, f.scope.businessId, {
        clock: () => AGENT_NOW,
        days: 100,
        batchSize: 1,
      }),
    ).toEqual({ messages: 0, runs: 0 });
    expect(
      (
        await redactBusinessContent(f.db, f.scope.businessId, {
          clock: () => AGENT_NOW,
          batchSize: 1,
        })
      ).messages,
    ).toBe(1);
    expect(
      (
        await redactBusinessContent(f.db, f.scope.businessId, {
          clock: () => AGENT_NOW,
          batchSize: 1,
        })
      ).messages,
    ).toBe(1);
    expect(
      (await other.db.message.findUniqueOrThrow({ where: { id: other.messageId } })).body,
    ).not.toBe("[redacted]");
    await expect(
      redactBusinessContent(f.db, f.scope.businessId, { clock: () => AGENT_NOW, days: 0 }),
    ).rejects.toThrow("Invalid retention configuration");
  });
  it("waits for in-flight sends, preserves bookings, and still reconciles redacted deliveries", async () => {
    const f = await setup();
    const held = await placeHold(f.db, {
      ...f.scope,
      ...f.input,
      startsAt: new Date(f.input.startsAt),
      clock: () => AGENT_NOW,
    });
    if (!held.ok) throw new Error("Expected hold");
    const booking = await bookFromHold(f.db, {
      businessId: f.scope.businessId,
      holdId: held.hold.id,
      clock: () => AGENT_NOW,
    });
    expect(booking.ok).toBe(true);
    const message = await f.db.message.create({
      data: {
        conversationId: f.scope.conversationId,
        channel: "whatsapp",
        direction: "outbound",
        author: "agent",
        body: "Old reply",
        createdAt: f.old,
      },
    });
    const work = await f.db.outboundWork.create({
      data: {
        businessId: f.scope.businessId,
        messageId: message.id,
        inboundSequence: f.inbox.sequence,
        phoneNumberId: f.phoneNumberId,
        state: "sending",
        attempts: 1,
        leaseUntil: new Date(AGENT_NOW.getTime() + 30000),
        createdAt: f.old,
      },
    });
    const attempt = await f.db.deliveryAttempt.create({
      data: {
        outboundId: work.id,
        number: 1,
        recipientHash: createHash("sha256").update("+15550001000").digest("hex"),
        startedAt: f.old,
      },
    });
    expect(
      await redactBusinessContent(f.db, f.scope.businessId, { clock: () => AGENT_NOW }),
    ).toEqual({ messages: 0, runs: 0 });
    const later = new Date(AGENT_NOW.getTime() + 31000);
    expect(await redactBusinessContent(f.db, f.scope.businessId, { clock: () => later })).toEqual({
      messages: 2,
      runs: 1,
    });
    expect((await f.db.outboundWork.findUniqueOrThrow({ where: { id: work.id } })).state).toBe(
      "uncertain",
    );
    expect(
      await f.db.booking.count({
        where: { businessId: f.scope.businessId, status: "pending_deposit" },
      }),
    ).toBe(1);
    await createWhatsAppStatusIntake(
      f.db,
      () => later,
    )({
      phoneNumberId: f.phoneNumberId,
      providerMessageId: "wamid.old-delivered",
      recipient: "+15550001000",
      state: "delivered",
      providerTimestamp: later,
      attemptId: attempt.id,
    });
    expect((await f.db.outboundWork.findUniqueOrThrow({ where: { id: work.id } })).state).toBe(
      "delivered",
    );
    expect((await f.db.message.findUniqueOrThrow({ where: { id: message.id } })).body).toBe(
      "[redacted]",
    );
    expect(
      (
        await createAgentStore(f.db, f.scope, () => later).claim(f.messageId, {
          model: "fake",
          promptVersion: "test",
          ratesVersion: "test",
        })
      ).state,
    ).toBe("silent");
  });
  it("refuses redacted records even if their queue state or timestamp was restored", async () => {
    const f = await setup();
    await redactBusinessContent(f.db, f.scope.businessId, { clock: () => AGENT_NOW });
    await f.db.message.update({ where: { id: f.messageId }, data: { createdAt: AGENT_NOW } });
    await f.db.inboundWork.update({
      where: { sequence: f.inbox.sequence },
      data: { state: "pending" },
    });
    expect(
      (
        await createInboxStore(f.db, f.scope.businessId, () => AGENT_NOW, 30).claim(
          String(f.inbox.sequence),
        )
      ).state,
    ).toBe("terminal");
    const message = await f.db.message.create({
      data: {
        conversationId: f.scope.conversationId,
        channel: "whatsapp",
        direction: "outbound",
        author: "agent",
        body: "[redacted]",
        createdAt: AGENT_NOW,
        redactedAt: AGENT_NOW,
      },
    });
    const work = await f.db.outboundWork.create({
      data: {
        businessId: f.scope.businessId,
        messageId: message.id,
        phoneNumberId: f.phoneNumberId,
        createdAt: AGENT_NOW,
        nextAttemptAt: AGENT_NOW,
      },
    });
    expect(
      (await createDeliveryStore(f.db, f.scope.businessId, () => AGENT_NOW, 30).begin(work.id))
        .state,
    ).toBe("skip");
  });
  it("expires unsent replies and waits for a recent legacy turn", async () => {
    const f = await setup();
    const message = await f.db.message.create({
      data: {
        conversationId: f.scope.conversationId,
        channel: "whatsapp",
        direction: "outbound",
        author: "agent",
        body: "Unsent",
        createdAt: f.old,
      },
    });
    const work = await f.db.outboundWork.create({
      data: {
        businessId: f.scope.businessId,
        messageId: message.id,
        phoneNumberId: f.phoneNumberId,
        createdAt: f.old,
      },
    });
    await f.db.agentRun.update({
      where: { id: f.runId },
      data: { startedAt: AGENT_NOW, finishedAt: null },
    });
    expect(
      await redactBusinessContent(f.db, f.scope.businessId, { clock: () => AGENT_NOW }),
    ).toEqual({ messages: 0, runs: 0 });
    await f.db.agentRun.update({ where: { id: f.runId }, data: { finishedAt: AGENT_NOW } });
    expect(
      await redactBusinessContent(f.db, f.scope.businessId, { clock: () => AGENT_NOW }),
    ).toEqual({ messages: 2, runs: 0 });
    expect((await f.db.outboundWork.findUniqueOrThrow({ where: { id: work.id } })).state).toBe(
      "suppressed",
    );
  });
});
