import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createWhatsAppIntake, registerWhatsAppNumber } from "../src/index";
import { agentFixture, AGENT_NOW } from "./agent-fixture";
import { baseUrl, useTestDatabase } from "./test-db";

describe.skipIf(!baseUrl)("durable WhatsApp intake", () => {
  const database = useTestDatabase();
  let serial = 1000;
  async function setup() {
    const db = database.db();
    const { scope } = await agentFixture(db);
    const phoneNumberId = String(++serial);
    await registerWhatsAppNumber(db, { phoneNumberId, businessId: scope.businessId });
    const message = {
      phoneNumberId,
      providerMessageId: randomUUID(),
      phone: "+12025550100",
      providerTimestamp: AGENT_NOW,
      kind: "text" as const,
      body: "Fictional inquiry",
    };
    return { db, scope, message, accept: createWhatsAppIntake(db, () => AGENT_NOW) };
  }
  it("commits one message and pending work item despite concurrent duplicates", async () => {
    const { db, scope, message, accept } = await setup();
    expect((await Promise.all([accept(message), accept(message)])).sort()).toEqual([
      "accepted",
      "duplicate",
    ]);
    const rows = await db.inboundWork.findMany({
      where: { businessId: scope.businessId },
      include: { message: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      state: "pending",
      kind: "text",
      receivedAt: AGENT_NOW,
      providerTimestamp: AGENT_NOW,
      message: { body: message.body, createdAt: AGENT_NOW },
    });
    expect(rows[0]!.sequence).toBeGreaterThan(0n);
    expect(
      await db.customer.count({ where: { businessId: scope.businessId, phone: message.phone } }),
    ).toBe(1);
  });
  it("serializes conversation selection and retains owner state", async () => {
    const { db, scope, message, accept } = await setup();
    await Promise.all([accept(message), accept({ ...message, providerMessageId: randomUUID() })]);
    const customer = await db.customer.findUniqueOrThrow({
      where: { businessId_phone: { businessId: scope.businessId, phone: message.phone } },
    });
    const conversations = await db.conversation.findMany({
      where: { businessId: scope.businessId, customerId: customer.id },
    });
    expect(conversations).toHaveLength(1);
    const conversation = conversations[0]!;
    await db.conversation.update({ where: { id: conversation.id }, data: { status: "owner" } });
    await accept({ ...message, providerMessageId: randomUUID() });
    expect(await db.conversation.findUnique({ where: { id: conversation.id } })).toMatchObject({
      status: "owner",
    });
    expect(await db.agentRun.count({ where: { conversationId: conversation.id } })).toBe(0);
    await db.conversation.update({ where: { id: conversation.id }, data: { status: "closed" } });
    await accept({ ...message, providerMessageId: randomUUID() });
    expect(
      await db.conversation.count({
        where: { businessId: scope.businessId, customerId: customer.id },
      }),
    ).toBe(2);
  });
  it("isolates tenants and refuses conflicting provider IDs and registration reassignment", async () => {
    const first = await setup();
    const other = await setup();
    await first.accept(first.message);
    expect(
      await other.accept({ ...first.message, phoneNumberId: other.message.phoneNumberId }),
    ).toBe("conflict");
    expect(await first.accept({ ...first.message, phone: "+12025550101" })).toBe("conflict");
    expect(await first.accept({ ...first.message, body: "changed" })).toBe("conflict");
    expect(await first.accept({ ...first.message, phoneNumberId: "999999" })).toBe("unregistered");
    expect(
      await other.db.inboundWork.count({ where: { businessId: other.scope.businessId } }),
    ).toBe(0);
    expect(
      await other.db.customer.count({
        where: { businessId: other.scope.businessId, phone: first.message.phone },
      }),
    ).toBe(0);
    await expect(
      registerWhatsAppNumber(first.db, {
        phoneNumberId: first.message.phoneNumberId,
        businessId: other.scope.businessId,
      }),
    ).rejects.toThrow("Number already registered");
    await registerWhatsAppNumber(first.db, {
      phoneNumberId: first.message.phoneNumberId,
      businessId: first.scope.businessId,
    });
    await expect(
      registerWhatsAppNumber(first.db, { phoneNumberId: "bad", businessId: "bad" }),
    ).rejects.toThrow("Invalid registration");
    await expect(
      registerWhatsAppNumber(first.db, { phoneNumberId: "999998", businessId: randomUUID() }),
    ).rejects.toThrow("Business not found");
  });
  it("does not extend the window on replay, older messages or future provider timestamps", async () => {
    const { db, scope, message, accept } = await setup();
    const old = { ...message, providerTimestamp: new Date(AGENT_NOW.getTime() - 60_000) };
    await accept(old);
    const stored = await db.message.findUniqueOrThrow({
      where: {
        channel_providerMessageId: {
          channel: "whatsapp",
          providerMessageId: message.providerMessageId,
        },
      },
    });
    const later = createWhatsAppIntake(db, () => new Date(AGENT_NOW.getTime() + 300_000));
    expect(await later(old)).toBe("duplicate");
    expect(
      await db.conversation.findUnique({ where: { id: stored.conversationId } }),
    ).toMatchObject({ lastCustomerMessageAt: old.providerTimestamp });
    await accept({
      ...message,
      providerMessageId: randomUUID(),
      providerTimestamp: new Date(AGENT_NOW.getTime() - 120_000),
    });
    expect(
      await db.conversation.findUnique({ where: { id: stored.conversationId } }),
    ).toMatchObject({ lastCustomerMessageAt: old.providerTimestamp });
    await accept({
      ...message,
      providerMessageId: randomUUID(),
      providerTimestamp: new Date(AGENT_NOW.getTime() + 3600_000),
      kind: "unsupported",
      body: "[Unsupported WhatsApp message]",
    });
    expect(
      await db.conversation.findUnique({ where: { id: stored.conversationId } }),
    ).toMatchObject({ lastCustomerMessageAt: AGENT_NOW });
    const work = await db.inboundWork.findMany({
      where: { businessId: scope.businessId },
      orderBy: { sequence: "asc" },
    });
    expect(work).toHaveLength(3);
    expect(work[2]!.kind).toBe("unsupported");
  });
  it("rolls back the message when the inbox write fails", async () => {
    const { db, scope, message, accept } = await setup();
    await db.$executeRawUnsafe(
      `CREATE FUNCTION reject_inbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'planted failure'; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER reject_inbox BEFORE INSERT ON "InboundWork" FOR EACH ROW EXECUTE FUNCTION reject_inbox()`,
    );
    try {
      await expect(accept(message)).rejects.toThrow();
      expect(
        await db.message.count({ where: { providerMessageId: message.providerMessageId } }),
      ).toBe(0);
      expect(
        await db.customer.count({ where: { businessId: scope.businessId, phone: message.phone } }),
      ).toBe(0);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER reject_inbox ON "InboundWork"`);
      await db.$executeRawUnsafe(`DROP FUNCTION reject_inbox()`);
    }
    expect(await accept(message)).toBe("accepted");
  });
});
