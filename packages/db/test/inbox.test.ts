import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createInboxStore, createWhatsAppIntake, registerWhatsAppNumber } from "../src/index";
import { agentFixture, AGENT_NOW } from "./agent-fixture";
import { baseUrl, useTestDatabase } from "./test-db";

describe.skipIf(!baseUrl)("inbox leases", () => {
  const database = useTestDatabase();
  let number = 5000;
  async function setup() {
    const db = database.db();
    const { scope } = await agentFixture(db);
    const phoneNumberId = String(++number);
    await registerWhatsAppNumber(db, { businessId: scope.businessId, phoneNumberId });
    const intake = createWhatsAppIntake(db, () => AGENT_NOW);
    const send = (phone = "+12025550100") =>
      intake({
        phoneNumberId,
        providerMessageId: randomUUID(),
        phone,
        providerTimestamp: AGENT_NOW,
        kind: "text",
        body: "Fictional message",
      });
    let now = AGENT_NOW;
    const store = createInboxStore(db, scope.businessId, () => now);
    return {
      db,
      scope,
      store,
      send,
      advance: (ms: number) => {
        now = new Date(now.getTime() + ms);
      },
    };
  }
  it("only dispatches and claims the oldest unfinished message per conversation", async () => {
    const { store, send } = await setup();
    await send();
    await send();
    await send("+12025550101");
    const due = await store.listDue();
    expect(due).toHaveLength(2);
    const [first, competing] = await Promise.all([
      store.claim(due[0]!.sequence),
      store.claim(due[0]!.sequence),
    ]);
    expect(first.state).toBe("claimed");
    expect(competing.state).toBe("busy");
    if (first.state !== "claimed") throw new Error("Expected claim");
    expect((await store.claim(due[1]!.sequence)).state).toBe("claimed");
    await store.complete(first.lease, "done");
    expect((await store.claim(first.lease.sequence)).state).toBe("terminal");
    expect(await store.listDue()).toHaveLength(1);
  });
  it("renews leases and fences expired or replaced owners", async () => {
    const { store, send, advance } = await setup();
    await send();
    const id = (await store.listDue())[0]!.sequence;
    const first = await store.claim(id);
    if (first.state !== "claimed") throw new Error("Expected claim");
    advance(60_000);
    await store.renew(first.lease);
    advance(60_000);
    expect(await store.listDue()).toHaveLength(0);
    advance(31_000);
    await expect(store.complete(first.lease, "done")).rejects.toThrow("Lease lost");
    const recovered = await store.claim(id);
    if (recovered.state !== "claimed") throw new Error("Expected recovered claim");
    expect(recovered.recovered).toBe(true);
    expect(recovered.lease.token).toBeGreaterThan(first.lease.token);
    await expect(store.renew(first.lease)).rejects.toThrow("Lease lost");
    await store.complete(recovered.lease, "skipped", "owner");
  });
  it("isolates tenants, validates IDs and refuses out-of-order claims", async () => {
    const { db, store, send, scope } = await setup();
    await send();
    await send();
    const rows = await db.inboundWork.findMany({
      where: { businessId: scope.businessId },
      orderBy: { sequence: "asc" },
    });
    expect((await store.claim(String(rows[1]!.sequence))).state).toBe("busy");
    const other = await setup();
    expect((await other.store.claim(String(rows[0]!.sequence))).state).toBe("missing");
    await expect(store.claim("not-an-id")).rejects.toThrow("Invalid inbox id");
    expect((await store.claim("999999999")).state).toBe("missing");
  });
  it("retries pre-start failures with a delay and stops after five attempts", async () => {
    const { store, send, advance } = await setup();
    await send();
    const id = (await store.listDue())[0]!.sequence;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const claim = await store.claim(id);
      if (claim.state !== "claimed") throw new Error("Expected claim");
      expect(claim.recovered).toBe(false);
      await store.retryBeforeStart(claim.lease);
      expect(await store.listDue()).toHaveLength(0);
      if (attempt < 5) expect((await store.claim(id)).state).toBe("busy");
      advance(60_000);
    }
    expect((await store.claim(id)).state).toBe("terminal");
    expect(await store.listDead()).toHaveLength(1);
  });
});
