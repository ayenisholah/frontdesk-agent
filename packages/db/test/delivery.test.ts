import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createInboxStore,
  createWhatsAppIntake,
  prepareInboxTurn,
  registerWhatsAppNumber,
} from "../src/index";
import { createWhatsAppStatusIntake } from "../src/delivery-status";
import { configureWhatsAppDelivery } from "../src/delivery-config";
import { createDeliveryOperator } from "../src/delivery-operator";
import { createDeliveryStore } from "../src/delivery";
import { agentFixture, AGENT_NOW } from "./agent-fixture";
import { baseUrl, useTestDatabase } from "./test-db";

describe.skipIf(!baseUrl)("durable outbound delivery", () => {
  const database = useTestDatabase();
  let number = 10000;
  async function setup() {
    const db = database.db();
    const { scope } = await agentFixture(db);
    const phoneNumberId = String(++number);
    let now = AGENT_NOW;
    const clock = () => now;
    await registerWhatsAppNumber(db, { businessId: scope.businessId, phoneNumberId });
    await db.whatsAppRegistration.update({
      where: { phoneNumberId },
      data: {
        credentialEnv: "FICTIONAL_TOKEN",
        graphVersion: "v25.0",
        ownerPhone: "+12025550199",
        templates: {
          owner: { name: "owner_incident", language: "en", verifiedAt: now.toISOString() },
          customer: { name: "owner_followup", language: "en", verifiedAt: now.toISOString() },
        },
      },
    });
    await createWhatsAppIntake(
      db,
      clock,
    )({
      phoneNumberId,
      providerMessageId: randomUUID(),
      phone: "+12025550170",
      providerTimestamp: now,
      kind: "unsupported",
      body: "Unsupported",
    });
    const inbox = createInboxStore(db, scope.businessId, clock);
    const claim = await inbox.claim((await inbox.listDue())[0]!.sequence);
    if (claim.state !== "claimed") throw new Error("Expected claim");
    await prepareInboxTurn(db, { ...claim.scope, lease: claim.lease }, clock);
    const store = createDeliveryStore(db, scope.businessId, clock);
    const ref = (await store.listDue())[0]!;
    return {
      db,
      scope: claim.scope,
      store,
      ref,
      phoneNumberId,
      clock,
      advance: (ms: number) => {
        now = new Date(now.getTime() + ms);
      },
    };
  }
  it("records attempts before sending, retries explicit refusals, and stores acceptance once", async () => {
    const f = await setup();
    for (let attempt = 0; attempt < 3; attempt++) {
      const claim = await f.store.begin(f.ref.id);
      if (claim.state !== "send") throw new Error("Expected send");
      expect(await f.db.deliveryAttempt.count({ where: { outboundId: f.ref.id } })).toBe(
        attempt + 1,
      );
      expect((await f.store.begin(f.ref.id)).state).toBe("skip");
      await f.store.resolve(
        claim.attemptId,
        attempt < 2
          ? { state: "retryable_rejection", retryAfterMs: 0 }
          : { state: "accepted", providerMessageId: "wamid.accepted" },
      );
      if (attempt < 2) {
        expect(await f.store.listDue()).toHaveLength(0);
        f.advance(150_000);
      }
    }
    expect(await f.store.listDue()).toHaveLength(0);
    expect(
      (await f.db.message.findFirstOrThrow({ where: { outboundWork: { id: f.ref.id } } }))
        .providerMessageId,
    ).toBe("wamid.accepted");
  });
  it("never retries uncertain sends and creates one durable owner alert", async () => {
    const f = await setup();
    const claim = await f.store.begin(f.ref.id);
    if (claim.state !== "send") throw new Error("Expected send");
    f.advance(31_000);
    expect((await f.store.begin(f.ref.id)).state).toBe("skip");
    expect((await f.db.outboundWork.findUniqueOrThrow({ where: { id: f.ref.id } })).state).toBe(
      "uncertain",
    );
    expect(await f.db.deliveryIncident.count({ where: { businessId: f.scope.businessId } })).toBe(
      1,
    );
    expect(
      (await f.db.conversation.findUniqueOrThrow({ where: { id: f.scope.conversationId } })).status,
    ).toBe("owner");
    const alert = (await f.store.listDue())[0]!;
    const send = await f.store.begin(alert.id);
    if (send.state !== "send") throw new Error("Expected alert");
    expect(send.message.content.type).toBe("template");
    await f.store.resolve(send.attemptId, { state: "permanent_rejection" });
    expect(await f.db.deliveryIncident.count({ where: { businessId: f.scope.businessId } })).toBe(
      1,
    );
  });
  it("rechecks owner control and the 24-hour window before the network attempt", async () => {
    const f = await setup();
    f.advance(86_400_000);
    expect((await f.store.begin(f.ref.id)).state).toBe("skip");
    const next = await setup();
    await next.db.conversation.update({
      where: { id: next.scope.conversationId },
      data: { status: "owner" },
    });
    expect((await next.store.begin(next.ref.id)).state).toBe("skip");
    expect(await next.db.deliveryAttempt.count({ where: { outboundId: next.ref.id } })).toBe(0);
  });
  it("does not allow another business to claim or finish delivery", async () => {
    const first = await setup();
    const other = await setup();
    expect((await other.store.begin(first.ref.id)).state).toBe("skip");
    const claim = await first.store.begin(first.ref.id);
    if (claim.state !== "send") throw new Error("Expected send");
    await other.store.resolve(claim.attemptId, { state: "accepted", providerMessageId: "foreign" });
    expect(
      (await first.db.outboundWork.findUniqueOrThrow({ where: { id: first.ref.id } })).state,
    ).toBe("sending");
  });
  it("correlates signed statuses by tenant, recipient and attempt without regressing delivery", async () => {
    const f = await setup();
    const claim = await f.store.begin(f.ref.id);
    if (claim.state !== "send") throw new Error("Expected send");
    await f.store.resolve(claim.attemptId, { state: "uncertain" });
    const accept = createWhatsAppStatusIntake(f.db, f.clock);
    const status = {
      phoneNumberId: f.phoneNumberId,
      providerMessageId: "wamid.reconciled",
      recipient: "+12025550170",
      state: "delivered" as const,
      providerTimestamp: f.clock(),
      attemptId: claim.attemptId,
    };
    expect(await accept({ ...status, phoneNumberId: "999999" })).toBe("ignored");
    expect(await accept({ ...status, recipient: "+12025550171" })).toBe("ignored");
    expect(await accept(status)).toBe("matched");
    expect(await accept(status)).toBe("matched");
    expect(await accept({ ...status, state: "read" })).toBe("matched");
    await accept({ ...status, state: "failed" });
    await f.store.resolve(claim.attemptId, {
      state: "accepted",
      providerMessageId: status.providerMessageId,
    });
    expect((await f.db.outboundWork.findUniqueOrThrow({ where: { id: f.ref.id } })).state).toBe(
      "read",
    );
    expect(await f.db.deliveryIncident.count({ where: { businessId: f.scope.businessId } })).toBe(
      1,
    );
    expect(await accept({ ...status, providerMessageId: "foreign" })).toBe("ignored");
  });
  it("provisions references only and resolves uncertain sends without resending", async () => {
    const f = await setup();
    const config = {
      businessId: f.scope.businessId,
      phoneNumberId: f.phoneNumberId,
      credentialEnv: "WHATSAPP_FICTIONAL_TOKEN",
      graphVersion: "v25.0",
      ownerPhone: "+12025550199",
      templates: {
        owner: { name: "incident", language: "en", verifiedAt: f.clock().toISOString() },
      },
    };
    await configureWhatsAppDelivery(f.db, config);
    await expect(
      configureWhatsAppDelivery(f.db, { ...config, credentialEnv: "DATABASE_URL" }),
    ).rejects.toThrow("Invalid delivery configuration");
    const claim = await f.store.begin(f.ref.id);
    if (claim.state !== "send") throw new Error("Expected send");
    await f.store.resolve(claim.attemptId, { state: "uncertain" });
    const operator = createDeliveryOperator(f.db, f.scope.businessId, f.clock);
    expect(await f.store.listDead()).toEqual([f.ref]);
    const rows = await operator.inspect();
    expect(rows.outbound[0]).toMatchObject({ id: f.ref.id, state: "uncertain" });
    expect(JSON.stringify(rows)).not.toContain("1202555");
    await operator.resolve(f.ref.id, { state: "accepted", providerMessageId: "wamid.operator" });
    expect((await f.db.outboundWork.findUniqueOrThrow({ where: { id: f.ref.id } })).state).toBe(
      "accepted",
    );
    expect(await f.db.deliveryAttempt.count({ where: { outboundId: f.ref.id } })).toBe(1);
    await expect(operator.resolve(f.ref.id, { state: "dead" })).rejects.toThrow(
      "Uncertain delivery unavailable",
    );
  });
  it("defers without sending, enforces ordering, and exhausts five explicit retries", async () => {
    const f = await setup();
    expect(await f.store.route(f.ref.id)).toMatchObject({ state: "pending" });
    await f.store.defer(f.ref.id, 1000);
    expect((await f.store.begin(f.ref.id)).state).toBe("skip");
    f.advance(1001);
    for (let n = 0; n < 5; n++) {
      const claim = await f.store.begin(f.ref.id);
      if (claim.state !== "send") throw new Error("Expected send");
      await f.store.resolve(claim.attemptId, { state: "retryable_rejection", retryAfterMs: 2000 });
      f.advance(150000);
    }
    expect(await f.store.route(f.ref.id)).toBeNull();
    expect((await f.store.begin(f.ref.id)).state).toBe("skip");
    const alert = (await f.store.listDue())[0]!;
    expect((await f.store.route(alert.id))?.recipientId).toBe(`owner-${f.scope.businessId}`);
    const claimed = await f.store.begin(alert.id);
    if (claimed.state !== "send") throw new Error("Expected alert");
    await f.store.resolve(claimed.attemptId, {
      state: "accepted",
      providerMessageId: "wamid.owner",
    });
    expect(
      (await f.db.deliveryIncident.findFirstOrThrow({ where: { businessId: f.scope.businessId } }))
        .state,
    ).toBe("notified");
  });
  it("fails closed for missing senders, credentials or approved templates", async () => {
    for (const mode of [
      "removed",
      "credentials",
      "templates",
      "invalidTemplates",
      "owner",
    ] as const) {
      const f = await setup();
      if (mode === "removed")
        await f.db.whatsAppRegistration.delete({ where: { phoneNumberId: f.phoneNumberId } });
      else
        await f.db.whatsAppRegistration.update({
          where: { phoneNumberId: f.phoneNumberId },
          data:
            mode === "credentials"
              ? { credentialEnv: null }
              : mode === "templates"
                ? { templates: {} }
                : mode === "invalidTemplates"
                  ? { templates: { owner: "invalid" } }
                  : { ownerPhone: null },
        });
      if (mode === "templates" || mode === "invalidTemplates") {
        await f.db.conversation.update({
          where: { id: f.scope.conversationId },
          data: { lastCustomerMessageAt: null },
        });
      }
      const claim = await f.store.begin(f.ref.id);
      if (claim.state === "send") await f.store.resolve(claim.attemptId, { state: "uncertain" });
      const alert = (await f.store.listDue())[0]!;
      expect((await f.store.begin(alert.id)).state).toBe("skip");
      expect(
        (
          await f.db.deliveryIncident.findFirstOrThrow({
            where: { businessId: f.scope.businessId },
          })
        ).state,
      ).toBe("failed");
    }
  });
  it("uses only a verified fixed template outside the window", async () => {
    const f = await setup();
    await f.db.conversation.update({
      where: { id: f.scope.conversationId },
      data: { lastCustomerMessageAt: null },
    });
    const claim = await f.store.begin(f.ref.id);
    if (claim.state !== "send") throw new Error("Expected template");
    expect(claim.message.content).toEqual({
      type: "template",
      name: "owner_followup",
      language: "en",
    });
    await f.store.resolve(claim.attemptId, { state: "uncertain" });
    const operator = createDeliveryOperator(f.db, f.scope.businessId, f.clock);
    await operator.resolve(f.ref.id, { state: "dead" });
    await expect(operator.resolve("invalid", {})).rejects.toThrow("Invalid delivery resolution");
    await expect(operator.resolve(f.ref.id, { state: "accepted" })).rejects.toThrow(
      "Invalid delivery resolution",
    );
    await expect(
      configureWhatsAppDelivery(f.db, {
        businessId: f.scope.businessId,
        phoneNumberId: "99999",
        credentialEnv: "WHATSAPP_FICTIONAL_TOKEN",
        graphVersion: "v25.0",
        ownerPhone: "+12025550199",
        templates: {
          owner: { name: "incident", language: "en", verifiedAt: f.clock().toISOString() },
        },
      }),
    ).rejects.toThrow("Sender registration unavailable");
  });
  it("deduplicates failed callbacks and ignores stale status events", async () => {
    const f = await setup();
    const claim = await f.store.begin(f.ref.id);
    if (claim.state !== "send") throw new Error("Expected send");
    await f.store.resolve(claim.attemptId, {
      state: "accepted",
      providerMessageId: "wamid.failed",
    });
    const accept = createWhatsAppStatusIntake(f.db, f.clock);
    const status = {
      phoneNumberId: f.phoneNumberId,
      providerMessageId: "wamid.failed",
      recipient: "+12025550170",
      state: "sent" as const,
      providerTimestamp: f.clock(),
    };
    await accept(status);
    const failure = {
      ...status,
      state: "failed" as const,
      providerTimestamp: new Date(f.clock().getTime() + 1000),
    };
    await accept(failure);
    await accept(failure);
    await accept(status);
    expect((await f.db.outboundWork.findUniqueOrThrow({ where: { id: f.ref.id } })).state).toBe(
      "dead",
    );
    expect(await f.db.deliveryIncident.count({ where: { businessId: f.scope.businessId } })).toBe(
      1,
    );
    const alert = await f.store.begin((await f.store.listDue())[0]!.id);
    if (alert.state !== "send") throw new Error("Expected alert");
    await accept({
      ...status,
      providerMessageId: "wamid.alert-status",
      recipient: "+12025550199",
      state: "read",
      attemptId: alert.attemptId,
    });
    expect(
      (await f.db.deliveryIncident.findFirstOrThrow({ where: { businessId: f.scope.businessId } }))
        .state,
    ).toBe("notified");
  });
  it("preserves ordering and allows only the agent's own handoff reply", async () => {
    const f = await setup();
    await createWhatsAppIntake(
      f.db,
      f.clock,
    )({
      phoneNumberId: f.phoneNumberId,
      providerMessageId: randomUUID(),
      phone: "+12025550170",
      providerTimestamp: f.clock(),
      kind: "unsupported",
      body: "Next",
    });
    const inbox = createInboxStore(f.db, f.scope.businessId, f.clock);
    const next = await inbox.claim((await inbox.listDue())[0]!.sequence);
    if (next.state !== "claimed") throw new Error("Expected inbox");
    await prepareInboxTurn(f.db, { ...next.scope, lease: next.lease }, f.clock);
    const second = await f.db.outboundWork.findFirstOrThrow({
      where: { businessId: f.scope.businessId, id: { not: f.ref.id } },
    });
    expect((await f.store.begin(second.id)).state).toBe("skip");
    const first = await f.store.begin(f.ref.id);
    if (first.state !== "send") throw new Error("Expected send");
    await f.store.resolve(first.attemptId, {
      state: "accepted",
      providerMessageId: "wamid.first-order",
    });
    await f.db.conversation.update({
      where: { id: f.scope.conversationId },
      data: { status: "owner", handoffReason: "customer_request" },
    });
    await f.db.outboundWork.update({
      where: { id: second.id },
      data: { allowOwner: true, ownerReason: "customer_request" },
    });
    expect((await f.store.begin(second.id)).state).toBe("send");
  });
  it("rejects stale attempt results and lets operators resolve failed owner notifications", async () => {
    const f = await setup();
    const claim = await f.store.begin(f.ref.id);
    if (claim.state !== "send") throw new Error("Expected send");
    await f.db.outboundWork.update({ where: { id: f.ref.id }, data: { attempts: 2 } });
    await f.store.resolve(claim.attemptId, { state: "accepted", providerMessageId: "stale" });
    await f.db.outboundWork.update({ where: { id: f.ref.id }, data: { attempts: 1 } });
    f.advance(31000);
    await f.store.begin(f.ref.id);
    await f.store.resolve(claim.attemptId, { state: "accepted", providerMessageId: "late" });
    expect((await f.db.outboundWork.findUniqueOrThrow({ where: { id: f.ref.id } })).state).toBe(
      "uncertain",
    );
    const alertId = (await f.store.listDue())[0]!.id;
    const alert = await f.store.begin(alertId);
    if (alert.state !== "send") throw new Error("Expected alert");
    await f.store.resolve(alert.attemptId, { state: "uncertain" });
    await createDeliveryOperator(f.db, f.scope.businessId, f.clock).resolve(alertId, {
      state: "accepted",
      providerMessageId: "wamid.operator-owner",
    });
    expect(
      (await f.db.deliveryIncident.findFirstOrThrow({ where: { businessId: f.scope.businessId } }))
        .state,
    ).toBe("notified");
    await f.db.outboundWork.update({ where: { id: alertId }, data: { state: "uncertain" } });
    await createDeliveryOperator(f.db, f.scope.businessId, f.clock).resolve(alertId, {
      state: "dead",
    });
    expect(
      (await f.db.deliveryIncident.findFirstOrThrow({ where: { businessId: f.scope.businessId } }))
        .state,
    ).toBe("failed");
  });
});
