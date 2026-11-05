// Integration: holds and bookings on a real database, including races.
import { harborPaws, type BusinessConfig } from "@frontdesk/core";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  bookFromHold,
  cancelBooking,
  placeHold,
  releaseExpired,
  rescheduleBooking,
  saveBusinessConfig,
  type Db,
} from "../src/index";
import { withSlotLock } from "../src/slots";
import { baseUrl, useTestDatabase } from "./test-db";

// A Monday in UTC, far enough ahead to stay in the future. Open every day 09:00-17:00.
const NOW = new Date("2031-03-02T08:00:00Z");
const at = (time: string) => new Date(`2031-03-03T${time}:00Z`);
const MINUTES = 60_000;

function config(slug: string, capacity: number, buffer = 0): BusinessConfig {
  return {
    ...structuredClone(harborPaws),
    slug,
    timezone: "UTC",
    capacity,
    buffers: { beforeMinutes: buffer, afterMinutes: buffer },
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

  const business = (capacity = 1, buffer = 0) =>
    saveBusinessConfig(db, config(`shop-${++serial}`, capacity, buffer));

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
    placeHold(db, { businessId, conversationId, serviceKey, startsAt, clock: () => now });

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

    it("refuses a sub-minute time near a real slot", async () => {
      const id = await business();
      const startsAt = new Date("2031-03-03T09:59:30Z");
      expect(await hold(id, await conversation(id), startsAt)).toEqual({
        ok: false,
        reason: "slot_unavailable",
      });
    });

    it("sees neighbouring bookings through the buffers", async () => {
      const id = await business(1, 30);
      const duration = harborPaws.services[0]!.durationMinutes;
      await heldId(id, at("10:00"));
      const end = at("10:00").getTime() + duration * MINUTES;
      const tooClose = await hold(id, await conversation(id), new Date(end + 45 * MINUTES));
      expect(tooClose).toEqual({ ok: false, reason: "slot_unavailable" });
      expect((await hold(id, await conversation(id), new Date(end + 60 * MINUTES))).ok).toBe(true);
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
        clock: () => NOW,
      });
      expect(unknown).toEqual({ ok: false, reason: "service_not_found" });
      await db.service.updateMany({
        where: { businessId: id, key: serviceKey },
        data: { active: false },
      });
      expect(await hold(id, conv, at("10:00"))).toEqual({ ok: false, reason: "service_not_found" });
    });
  });

  describe("releaseExpired", () => {
    it("expires only stale holds and names their conversations", async () => {
      const id = await business();
      const conv = await conversation(id);
      const result = await hold(id, conv, at("10:00"));
      const holdId = result.ok ? result.hold.id : "";
      const boundary = new Date(NOW.getTime() + 15 * MINUTES);
      expect(await releaseExpired(db, new Date(boundary.getTime() - 1))).not.toContain(conv);
      expect(await releaseExpired(db, boundary)).toContain(conv);
      expect((await db.hold.findUniqueOrThrow({ where: { id: holdId } })).status).toBe("expired");
    });

    it("cancels unpaid bookings past their due time and names the conversation", async () => {
      const id = await business();
      const conv = await conversation(id);
      const held = await hold(id, conv, at("10:00"));
      const holdId = held.ok ? held.hold.id : "";
      const booked = await bookFromHold(db, { businessId: id, holdId, clock: () => NOW });
      const bookingId = booked.ok ? booked.booking.id : "";
      expect(await releaseExpired(db, new Date(NOW.getTime() + 15 * MINUTES))).toContain(conv);
      const row = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(row.status).toBe("cancelled");
    });

    it("leaves paid bookings alone", async () => {
      const id = await business();
      const holdId = await heldId(id, at("10:00"));
      const booked = await bookFromHold(db, { businessId: id, holdId, clock: () => NOW });
      const bookingId = booked.ok ? booked.booking.id : "";
      await db.booking.update({ where: { id: bookingId }, data: { status: "confirmed" } });
      await releaseExpired(db, new Date(NOW.getTime() + 60 * MINUTES));
      expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe(
        "confirmed",
      );
    });
  });

  describe("bookFromHold", () => {
    it("creates a pending booking at the configured price and converts the hold", async () => {
      const id = await business();
      const holdId = await heldId(id, at("10:00"));
      const result = await bookFromHold(db, { businessId: id, holdId, clock: () => NOW });
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
      await bookFromHold(db, { businessId: id, holdId, clock: () => NOW });
      expect((await hold(id, await conversation(id), at("10:00"))).ok).toBe(false);
    });

    it("refuses an expired, used, unknown or foreign hold", async () => {
      const id = await business();
      const holdId = await heldId(id, at("10:00"));
      const refused = { ok: false, reason: "hold_not_valid" };
      const late = new Date(NOW.getTime() + 15 * MINUTES);
      expect(await bookFromHold(db, { businessId: id, holdId, clock: () => late })).toEqual(
        refused,
      );
      expect(
        await bookFromHold(db, { businessId: await business(), holdId, clock: () => NOW }),
      ).toEqual(refused);
      await bookFromHold(db, { businessId: id, holdId, clock: () => NOW });
      expect(await bookFromHold(db, { businessId: id, holdId, clock: () => NOW })).toEqual(refused);
      const unknown = "00000000-0000-4000-8000-000000000000";
      expect(await bookFromHold(db, { businessId: id, holdId: unknown, clock: () => NOW })).toEqual(
        refused,
      );
    });

    it("uses the next lane when capacity allows", async () => {
      const id = await business(2);
      const lanes = [];
      for (const holdId of [await heldId(id, at("10:00")), await heldId(id, at("10:00"))]) {
        const result = await bookFromHold(db, { businessId: id, holdId, clock: () => NOW });
        if (result.ok)
          lanes.push(
            (await db.booking.findUniqueOrThrow({ where: { id: result.booking.id } })).lane,
          );
      }
      expect(lanes).toEqual([0, 1]);
    });

    it("sets the deposit due time from the hold", async () => {
      const id = await business();
      const holdId = await heldId(id, at("10:00"));
      const booked = await bookFromHold(db, { businessId: id, holdId, clock: () => NOW });
      const row = await db.booking.findUniqueOrThrow({
        where: { id: booked.ok ? booked.booking.id : "" },
      });
      expect(row.depositDueAt).toEqual(new Date(NOW.getTime() + 15 * MINUTES));
    });

    it("frees an overdue unpaid booking for the next claim", async () => {
      const id = await business();
      const holdId = await heldId(id, at("10:00"));
      await bookFromHold(db, { businessId: id, holdId, clock: () => NOW });
      const later = new Date(NOW.getTime() + 15 * MINUTES);
      expect((await hold(id, await conversation(id), at("10:00"), later)).ok).toBe(true);
    });

    it("refuses a hold whose appointment has already started", async () => {
      const id = await business();
      const earlyNow = new Date("2031-03-03T08:50:00Z");
      const conv = await conversation(id);
      const held = await hold(id, conv, at("09:00"), earlyNow);
      const holdId = held.ok ? held.hold.id : "";
      const result = await bookFromHold(db, { businessId: id, holdId, clock: () => at("09:01") });
      expect(result).toEqual({ ok: false, reason: "slot_unavailable" });
    });

    it("refuses when hours change after the hold", async () => {
      const id = await business();
      const slug = (await db.business.findUniqueOrThrow({ where: { id } })).slug;
      const holdId = await heldId(id, at("10:00"));
      const shorter = config(slug, 1);
      shorter.openingHours = shorter.openingHours.map((h) => ({ ...h, open: "12:00" }));
      await saveBusinessConfig(db, shorter);
      const result = await bookFromHold(db, { businessId: id, holdId, clock: () => NOW });
      expect(result).toEqual({ ok: false, reason: "slot_unavailable" });
    });

    it("refuses when capacity drops after the hold, whichever lane is free", async () => {
      const id = await business(2);
      const slug = (await db.business.findUniqueOrThrow({ where: { id } })).slug;
      const first = await heldId(id, at("10:00"));
      const booked = await bookFromHold(db, { businessId: id, holdId: first, clock: () => NOW });
      await db.booking.update({
        where: { id: booked.ok ? booked.booking.id : "" },
        data: { lane: 1 },
      });
      const second = await heldId(id, at("10:00"));
      await saveBusinessConfig(db, config(slug, 1));
      const result = await bookFromHold(db, { businessId: id, holdId: second, clock: () => NOW });
      expect(result).toEqual({ ok: false, reason: "slot_unavailable" });
    });

    it("reports a full slot when the engine allows it but no lane is free", async () => {
      const id = await business(2);
      const holdId = await heldId(id, at("10:00"));
      const held = await db.hold.findUniqueOrThrow({
        where: { id: holdId },
        include: { conversation: true },
      });
      const half = (held.endsAt.getTime() - held.startsAt.getTime()) / 2;
      const fill = (start: number, lane: number) =>
        db.booking.create({
          data: {
            businessId: id,
            customerId: held.conversation.customerId,
            serviceId: held.serviceId,
            startsAt: new Date(start),
            endsAt: new Date(start + half),
            lane,
            priceCents: 1,
            depositCents: 1,
          },
        });
      // Back-to-back jobs on different lanes: peak is 1, but no lane is free for the whole slot.
      await fill(held.startsAt.getTime(), 0);
      await fill(held.startsAt.getTime() + half, 1);
      expect(await bookFromHold(db, { businessId: id, holdId, clock: () => NOW })).toEqual({
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
      const result = await bookFromHold(db, { businessId, holdId, clock: () => NOW });
      if (!result.ok) throw new Error(result.reason);
      const row = await db.booking.findUniqueOrThrow({ where: { id: result.booking.id } });
      return { businessId, bookingId: row.id, customerId: row.customerId, clock: () => NOW };
    }

    /** The window policy applies to paid bookings; an unpaid one would already be released. */
    async function paid(capacity = 1) {
      const request = await booked(capacity);
      await db.booking.update({ where: { id: request.bookingId }, data: { status: "confirmed" } });
      return request;
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
        const request = await paid();
        const result = await cancelBooking(db, { ...request, clock: () => late });
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

      it("applies the same customer, tenant and policy rules as cancelling", async () => {
        const request = await paid();
        const move = { ...request, startsAt: at("14:00") };
        const other = await db.customer.create({
          data: { businessId: request.businessId, phone: "+15559990001", channel: "sms" },
        });
        expect(await rescheduleBooking(db, { ...move, clock: () => late })).toMatchObject({
          ok: false,
          reason: "outside_policy",
        });
        expect(await rescheduleBooking(db, { ...move, customerId: other.id })).toEqual({
          ok: false,
          reason: "not_customers_booking",
        });
        expect(await rescheduleBooking(db, { ...move, businessId: await business() })).toEqual({
          ok: false,
          reason: "booking_not_found",
        });
      });

      it("refuses a sub-minute time", async () => {
        const request = await booked();
        const startsAt = new Date("2031-03-03T13:59:30Z");
        expect(await rescheduleBooking(db, { ...request, startsAt })).toEqual({
          ok: false,
          reason: "slot_unavailable",
        });
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

    it("lets only one of a move and a hold take the same slot", async () => {
      const id = await business();
      const holdId = await heldId(id, at("10:00"));
      const booked = await bookFromHold(db, { businessId: id, holdId, clock: () => NOW });
      const bookingId = booked.ok ? booked.booking.id : "";
      const { customerId } = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
      const conv = await conversation(id);
      const [moved, held] = await Promise.all([
        rescheduleBooking(db, {
          businessId: id,
          bookingId,
          customerId,
          startsAt: at("14:00"),
          clock: () => NOW,
        }),
        hold(id, conv, at("14:00")),
      ]);
      expect([moved.ok, held.ok].filter(Boolean)).toHaveLength(1);
    }, 30_000);

    it("reads the clock only after getting the lock", async () => {
      const id = await business();
      const clock = vi.fn(() => NOW);
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked = () => {};
      const holding = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const first = withSlotLock(
        db,
        id,
        () => NOW,
        async () => {
          locked();
          await gate;
        },
      );
      await holding;
      const second = withSlotLock(db, id, clock, async () => {});
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(clock).not.toHaveBeenCalled();
      release();
      await Promise.all([first, second]);
      expect(clock).toHaveBeenCalledOnce();
    }, 30_000);

    it("books each hold once when the same hold is submitted together", async () => {
      const id = await business();
      const holdId = await heldId(id, at("10:00"));
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          bookFromHold(db, { businessId: id, holdId, clock: () => NOW }),
        ),
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
