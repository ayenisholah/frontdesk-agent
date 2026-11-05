// Integration: needs a Postgres server (DATABASE_URL). Runs in CI against a service container.
import { beforeAll, describe, expect, it } from "vitest";
import { harborPaws, type BusinessConfig } from "@frontdesk/core";
import { loadBusinessConfig, saveBusinessConfig, type Db } from "../src/index";
import { baseUrl, useTestDatabase } from "./test-db";

describe.skipIf(!baseUrl)("business config persistence", () => {
  const database = useTestDatabase();
  let db: Db;

  beforeAll(() => {
    db = database.db();
  });

  const counts = async () => ({
    businesses: await db.business.count(),
    services: await db.service.count(),
    hours: await db.openingHours.count(),
  });

  it("round-trips the pilot fixture exactly", async () => {
    await saveBusinessConfig(db, harborPaws);
    expect(await loadBusinessConfig(db, harborPaws.slug)).toEqual(harborPaws);
  });

  it("is idempotent: saving twice changes nothing", async () => {
    const before = await counts();
    const id = await saveBusinessConfig(db, harborPaws);
    expect(await counts()).toEqual(before);
    expect(before).toEqual({ businesses: 1, services: harborPaws.services.length, hours: 6 });
    expect(id).toBeTruthy();
  });

  it("applies edits and deactivates removed services instead of deleting them", async () => {
    const edited: BusinessConfig = structuredClone(harborPaws);
    edited.services = edited.services.filter((s) => s.id !== "teeth-brushing");
    edited.services[0]!.priceCents = 4500;
    edited.openingHours = edited.openingHours.filter((h) => h.weekday !== 6);

    await saveBusinessConfig(db, edited);
    expect(await loadBusinessConfig(db, harborPaws.slug)).toEqual(edited);
    expect(await db.service.count()).toBe(harborPaws.services.length);
    expect(await db.service.count({ where: { active: false } })).toBe(1);

    await saveBusinessConfig(db, harborPaws); // restoring reactivates it
    expect(await loadBusinessConfig(db, harborPaws.slug)).toEqual(harborPaws);
  });

  it("refuses to save an invalid config", async () => {
    const bad = { ...structuredClone(harborPaws), timezone: "Mars/Olympus" };
    await expect(saveBusinessConfig(db, bad)).rejects.toThrow(
      /timezone: must be an IANA time zone/,
    );
  });

  it("returns null for an unknown business", async () => {
    expect(await loadBusinessConfig(db, "no-such-business")).toBeNull();
  });

  it("dedupes messages by provider id (schema constraint for NFR-2)", async () => {
    const business = await db.business.findUniqueOrThrow({ where: { slug: harborPaws.slug } });
    const customer = await db.customer.create({
      data: { businessId: business.id, phone: "+15555550100", channel: "whatsapp" },
    });
    const conversation = await db.conversation.create({
      data: { businessId: business.id, customerId: customer.id, channel: "whatsapp" },
    });
    const message = {
      conversationId: conversation.id,
      direction: "inbound" as const,
      author: "customer" as const,
      channel: "whatsapp" as const,
      providerMessageId: "wamid.TEST1",
      body: "Hi, can I book a groom?",
    };
    await db.message.create({ data: message });
    await expect(db.message.create({ data: message })).rejects.toThrow(/Unique constraint/);
  });
});
