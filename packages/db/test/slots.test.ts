// Integration: holds and bookings on a real database, including races.
import { harborPaws, type BusinessConfig } from "@frontdesk/core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  bookFromHold,
  cancelBooking,
  expireHolds,
  placeHold,
  rescheduleBooking,
  saveBusinessConfig,
  type Db,
} from "../src/index";
import { baseUrl, useTestDatabase } from "./test-db";

// A Monday in UTC, far enough ahead to stay in the future. Open every day 09:00-17:00.
const NOW = new Date("2031-03-02T08:00:00Z");
const at = (time: string) => new Date(`2031-03-03T${time}:00Z`);
const MINUTES = 60_000;

function config(slug: string, capacity: number): BusinessConfig {
  return {
    ...structuredClone(harborPaws),
    slug,
    timezone: "UTC",
    capacity,
    buffers: { beforeMinutes: 0, afterMinutes: 0 },
    openingHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      open: "09:00",
      close: "17:00",
    })),
  };
}

describe.skipIf(!baseUrl)("holds and bookings", () => {
  const database = useTestDatabase();
  let db: Db;
  let serial = 0;
  const serviceKey = harborPaws.services[0]!.id;

  beforeAll(() => {
    db = database.db();
  });

  const business = (capacity = 1) => saveBusinessConfig(db, config(`shop-${++serial}`, capacity));

  async function conversation(businessId: string) {
    const customer = await db.customer.create({
      data: {
        businessId,
        phone: `+1555000${String(++serial).padStart(4, "0")}`,
        channel: "whatsapp",
      },
    });
    const row = await db.conversation.create({
      data: { businessId, customerId: customer.id, channel: "whatsapp" },
    });
    return row.id;
  }

  const hold = (businessId: string, conversationId: string, startsAt: Date, now = NOW) =>
    placeHold(db, { businessId, conversationId, serviceKey, startsAt, now });

  async function heldId(businessId: string, startsAt: Date) {
    const result = await hold(businessId, await conversation(businessId), startsAt);
    if (!result.ok) throw new Error(result.reason);
    return result.hold.id;
  }

  describe("placeHold", () => {
    it("holds a real slot for 15 minutes, with the service's duration", async () => {
      const id = await business();
      const result = await hold(id, await conversation(id), at("10:00"));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.hold.expiresAt).toEqual(new Date(NOW.getTime() + 15 * MINUTES));
      const minutes = (result.hold.endsAt.getTime() - result.hold.startsAt.getTime()) / MINUTES;
      expect(minutes).toBe(harborPaws.services[0]!.durationMinutes);
    });

    it("refuses an invented time", async () => {
      const id = await business();
      const result = await hold(id, await conversation(id), at("10:07"));
      expect(result).toEqual({ ok: false, reason: "slot_unavailable" });
    });

    it("refuses another conversation's slot at capacity", async () => {
      const id = await business();
      await heldId(id, at("10:00"));
      expect(await hold(id, await conversation(id), at("10:00"))).toEqual({
        ok: false,
        reason: "slot_unavailable",
      });
    });

    it("replaces the conversation's hold, and can move within its own time", async () => {
      const id = await business();
      const conv = await conversation(id);
      const first = await hold(id, conv, at("10:00"));
      const second = await hold(id, conv, at("10:15"));
      expect(second.ok).toBe(true);
      const statuses = await db.hold.findMany({
        where: { conversationId: conv },
        orderBy: { createdAt: "asc" },
      });
      expect(statuses.map((h) => h.status)).toEqual(["released", "active"]);
      expect(first.ok && statuses[0]?.id).toBe(first.ok && first.hold.id);
    });

    it("keeps the existing hold when the replacement is refused", async () => {
      const id = await business();
      const conv = await conversation(id);
      await hold(id, conv, at("10:00"));
      expect((await hold(id, conv, at("10:07"))).ok).toBe(false);
      expect(await db.hold.count({ where: { conversationId: conv, status: "active" } })).toBe(1);
    });

    it("frees the slot once a hold expires, even before its status changes", async () => {
      const id = await business();
      await heldId(id, at("10:00"));
      const later = new Date(NOW.getTime() + 16 * MINUTES);
      expect((await hold(id, await conversation(id), at("10:00"), later)).ok).toBe(true);
    });

    it("refuses a conversation from another business", async () => {
      const mine = await business();
      const other = await business();
      const result = await hold(mine, await conversation(other), at("10:00"));
      expect(result).toEqual({ ok: false, reason: "conversation_not_found" });
    });

    it("refuses an unknown or inactive service", async () => {
      const id = await business();
      const conv = await conversation(id);
      const unknown = await placeHold(db, {
        businessId: id,
        conversationId: conv,
        serviceKey: "nope",
        startsAt: at("10:00"),
        now: NOW,
      });
      expect(unknown).toEqual({ ok: false, reason: "service_not_found" });
      await db.service.updateMany({
        where: { businessId: id, key: serviceKey },
        data: { active: false },
      });
      expect(await hold(id, conv, at("10:00"))).toEqual({ ok: false, reason: "service_not_found" });
    });
  });

  describe("expireHolds", () => {
    it("expires only stale holds", async () => {
      const id = await business();
      const stale = await heldId(id, at("10:00"));
      const boundary = new Date(NOW.getTime() + 15 * MINUTES);
      const before = await expireHolds(db, new Date(boundary.getTime() - 1));
      expect(before).toBe(0);
      expect(await expireHolds(db, boundary)).toBeGreaterThanOrEqual(1);
      expect((await db.hold.findUniqueOrThrow({ where: { id: stale } })).status).toBe("expired");
    });
  });

  describe("bookFromHold", () => {
    it("creates a pending booking at the configured price and converts the hold", async () => {
      const id = await business();
      const holdId = await heldId(id, at("10:00"));
      const result = await bookFromHold(db, { businessId: id, holdId, now: NOW });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const row = await db.booking.findUniqueOrThrow({ where: { id: result.booking.id } });
      expect(row).toMatchObject({
        status: "pending_deposit",
        lane: 0,
        priceCents: harborPaws.services[0]!.priceCents,
        depositCents: harborPaws.services[0]!.depositCents,
        startsAt: at("10:00"),
      });
      expect((await db.hold.findUniqueOrThrow({ where: { id: holdId } })).status).toBe("converted");
    });

    it("keeps blocking the slot once booked", async () => {
      const id = await business();
      const holdId = await heldId(id, at("10:00"));
      await bookFromHold(db, { businessId: id, holdId, now: NOW });
      expect((await hold(id, await conversation(id), at("10:00"))).ok).toBe(false);
    });

    it("refuses an expired, used, unknown or foreign hold", async () => {
      const id = await business();
      const holdId = await heldId(id, at("10:00"));
      const refused = { ok: false, reason: "hold_not_valid" };
      const late = new Date(NOW.getTime() + 15 * MINUTES);
      expect(await bookFromHold(db, { businessId: id, holdId, now: late })).toEqual(refused);
      expect(await bookFromHold(db, { businessId: await business(), holdId, now: NOW })).toEqual(
        refused,
      );
      await bookFromHold(db, { businessId: id, holdId, now: NOW });
      expect(await bookFromHold(db, { businessId: id, holdId, now: NOW })).toEqual(refused);
      const unknown = "00000000-0000-4000-8000-000000000000";
      expect(await bookFromHold(db, { businessId: id, holdId: unknown, now: NOW })).toEqual(
        refused,
      );
    });

    it("uses the next lane when capacity allows", async () => {
      const id = await business(2);
      const lanes = [];
      for (const holdId of [await heldId(id, at("10:00")), await heldId(id, at("10:00"))]) {
        const result = await bookFromHold(db, { businessId: id, holdId, now: NOW });
        if (result.ok)
          lanes.push(
            (await db.booking.findUniqueOrThrow({ where: { id: result.booking.id } })).lane,
          );
      }
      expect(lanes).toEqual([0, 1]);
    });

    it("reports a full slot when no lane is free", async () => {
      const id = await business();
      const holdId = await heldId(id, at("10:00"));
      const held = await db.hold.findUniqueOrThrow({
        where: { id: holdId },
        include: { conversation: true, service: true },
      });
      await db.booking.create({
        data: {
          businessId: id,
          customerId: held.conversation.customerId,
          serviceId: held.serviceId,
          startsAt: held.startsAt,
          endsAt: held.endsAt,
          priceCents: 1,
          depositCents: 1,
        },
      });
      expect(await bookFromHold(db, { businessId: id, holdId, now: NOW })).toEqual({
        ok: false,
        reason: "slot_unavailable",
      });
    });
  });

  describe("changing a booking", () => {
    /** Books 10:00 tomorrow and returns everything a change needs. */
    async function booked(capacity = 1) {
      const businessId = await business(capacity);
      const holdId = await heldId(businessId, at("10:00"));
      const result = await bookFromHold(db, { businessId, holdId, now: NOW });
      if (!result.ok) throw new Error(result.reason);
      const row = await db.booking.findUniqueOrThrow({ where: { id: result.booking.id } });
      return { businessId, bookingId: row.id, customerId: row.customerId, now: NOW };
    }

    const statusOf = async (id: string) =>
      (await db.booking.findUniqueOrThrow({ where: { id } })).status;
    const late = new Date(at("10:00").getTime() - 60 * MINUTES);

    describe("cancelBooking", () => {
      it("cancels and frees the slot", async () => {
        const request = await booked();
        expect(await cancelBooking(db, request)).toEqual({ ok: true });
        const row = await db.booking.findUniqueOrThrow({ where: { id: request.bookingId } });
        expect(row.status).toBe("cancelled");
        expect(row.cancelledAt).toEqual(NOW);
        const next = await hold(
          request.businessId,
          await conversation(request.businessId),
          at("10:00"),
        );
        expect(next.ok).toBe(true);
      });

      it("refuses a different customer", async () => {
        const request = await booked();
        const other = await db.customer.create({
          data: { businessId: request.businessId, phone: "+15559990000", channel: "sms" },
        });
        const result = await cancelBooking(db, { ...request, customerId: other.id });
        expect(result).toEqual({ ok: false, reason: "not_customers_booking" });
        expect(await statusOf(request.bookingId)).toBe("pending_deposit");
      });

      it("refuses inside the window with the policy text", async () => {
        const request = await booked();
        const result = await cancelBooking(db, { ...request, now: late });
        expect(result).toMatchObject({ ok: false, reason: "outside_policy" });
        expect(!result.ok && "policy" in result && result.policy).toContain("hours before");
      });

      it("refuses a booking from another business, or one already cancelled", async () => {
        const request = await booked();
        const refused = { ok: false, reason: "booking_not_found" };
        expect(await cancelBooking(db, { ...request, businessId: await business() })).toEqual(
          refused,
        );
        await cancelBooking(db, request);
        expect(await cancelBooking(db, request)).toEqual(refused);
      });
    });

    describe("rescheduleBooking", () => {
      it("moves the booking and frees the old slot", async () => {
        const request = await booked();
        const result = await rescheduleBooking(db, { ...request, startsAt: at("14:00") });
        expect(result.ok).toBe(true);
        const row = await db.booking.findUniqueOrThrow({ where: { id: request.bookingId } });
        expect(row.startsAt).toEqual(at("14:00"));
        const next = await hold(
          request.businessId,
          await conversation(request.businessId),
          at("10:00"),
        );
        expect(next.ok).toBe(true);
      });

      it("can move a little, overlapping its own old time", async () => {
        const request = await booked();
        expect((await rescheduleBooking(db, { ...request, startsAt: at("10:15") })).ok).toBe(true);
      });

      it("refuses a taken slot and leaves the booking alone", async () => {
        const request = await booked();
        await heldId(request.businessId, at("14:00"));
        const result = await rescheduleBooking(db, { ...request, startsAt: at("14:00") });
        expect(result).toEqual({ ok: false, reason: "slot_unavailable" });
        const row = await db.booking.findUniqueOrThrow({ where: { id: request.bookingId } });
        expect(row.startsAt).toEqual(at("10:00"));
      });

      it("refuses an invented time", async () => {
        const request = await booked();
        const result = await rescheduleBooking(db, { ...request, startsAt: at("14:07") });
        expect(result).toEqual({ ok: false, reason: "slot_unavailable" });
      });

      it("applies the same customer and policy rules as cancelling", async () => {
        const request = await booked();
        const result = await rescheduleBooking(db, {
          ...request,
          startsAt: at("14:00"),
          now: late,
        });
        expect(result).toMatchObject({ ok: false, reason: "outside_policy" });
      });

      it("reports a full slot when the engine allows it but no lane is free", async () => {
        const request = await booked(2);
        const { service, customerId } = await db.booking.findUniqueOrThrow({
          where: { id: request.bookingId },
          include: { service: true },
        });
        const fill = (startsAt: Date, lane: number) =>
          db.booking.create({
            data: {
              businessId: request.businessId,
              customerId,
              serviceId: service.id,
              startsAt,
              endsAt: new Date(startsAt.getTime() + service.durationMinutes * MINUTES),
              lane,
              priceCents: 1,
              depositCents: 1,
            },
          });
        // Back-to-back jobs on different lanes: peak is 1, but no lane is free for the whole move.
        await fill(new Date(at("14:00").getTime() - service.durationMinutes * MINUTES), 0);
        await fill(at("14:00"), 1);
        const start = new Date(at("14:00").getTime() - (service.durationMinutes * MINUTES) / 2);
        expect(await rescheduleBooking(db, { ...request, startsAt: start })).toEqual({
          ok: false,
          reason: "slot_unavailable",
        });
      });
    });
  });

  describe("races", () => {
    it.each([1, 2])(
      "lets exactly %i of many simultaneous holds through",
      async (capacity) => {
        const id = await business(capacity);
        const conversations = await Promise.all(Array.from({ length: 8 }, () => conversation(id)));
        const results = await Promise.all(conversations.map((conv) => hold(id, conv, at("10:00"))));
        expect(results.filter((r) => r.ok)).toHaveLength(capacity);
      },
      30_000,
    );

    it("books each hold once when the same hold is submitted together", async () => {
      const id = await business();
      const holdId = await heldId(id, at("10:00"));
      const results = await Promise.all(
        Array.from({ length: 5 }, () => bookFromHold(db, { businessId: id, holdId, now: NOW })),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(await db.booking.count({ where: { businessId: id } })).toBe(1);
    }, 30_000);
  });

  describe("database backstops", () => {
    async function booking(
      businessId: string,
      lane: number,
      status: "confirmed" | "cancelled" = "confirmed",
    ) {
      const conv = await db.conversation.findFirstOrThrow({ where: { businessId } });
      const service = await db.service.findFirstOrThrow({ where: { businessId } });
      return db.booking.create({
        data: {
          businessId,
          customerId: conv.customerId,
          serviceId: service.id,
          startsAt: at("10:00"),
          endsAt: at("11:00"),
          lane,
          status,
          priceCents: 1,
          depositCents: 1,
        },
      });
    }

    it("rejects overlapping active bookings on one lane, whatever the code does", async () => {
      const id = await business();
      await conversation(id);
      await booking(id, 0);
      await expect(booking(id, 0)).rejects.toThrow();
      await expect(booking(id, 1)).resolves.toBeDefined();
      await expect(booking(id, 0, "cancelled")).resolves.toBeDefined();
    });

    it("rejects a second active hold in one conversation", async () => {
      const id = await business();
      const conv = await conversation(id);
      const service = await db.service.findFirstOrThrow({ where: { businessId: id } });
      const data = {
        businessId: id,
        conversationId: conv,
        serviceId: service.id,
        startsAt: at("10:00"),
        endsAt: at("11:00"),
        expiresAt: at("10:00"),
      };
      await db.hold.create({ data });
      await expect(db.hold.create({ data })).rejects.toThrow();
    });
  });
});
