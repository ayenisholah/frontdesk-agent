// Shared by every write that claims time. See docs/adr/0010-booking-concurrency.md.
import { formatMinuteOfDay, type Interval } from "@frontdesk/core";
import type { Db, Tx } from "./client";
import { BookingStatus, HoldStatus } from "./generated/enums";

const MINUTE_MS = 60_000;

/** Statuses that occupy time. Must match the Booking_no_lane_overlap constraint. */
const OCCUPYING: BookingStatus[] = [BookingStatus.pending_deposit, BookingStatus.confirmed];

/** Runs `work` while holding the business's slot lock, so claims can't race each other. */
export function withSlotLock<T>(
  db: Db,
  businessId: string,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${businessId}::text, 0))`;
      return work(tx);
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}

/** The availability rules for a business, in the shape the engine expects. */
export async function loadRules(tx: Tx, businessId: string) {
  const b = await tx.business.findUniqueOrThrow({
    where: { id: businessId },
    include: { openingHours: true },
  });
  return {
    timezone: b.timezone,
    capacity: b.capacity,
    buffers: { beforeMinutes: b.bufferBeforeMinutes, afterMinutes: b.bufferAfterMinutes },
    openingHours: b.openingHours.map((h) => ({
      weekday: h.weekday,
      open: formatMinuteOfDay(h.openMinute),
      close: formatMinuteOfDay(h.closeMinute),
    })),
  };
}

type Rules = Awaited<ReturnType<typeof loadRules>>;

export type BusyQuery = {
  businessId: string;
  rules: Rules;
  startsAt: Date;
  endsAt: Date;
  now: Date;
  /** Ignore this conversation's hold, so a replacement can reuse its own time. */
  exceptConversationId?: string;
};

/**
 * Time already taken around a slot. An expired hold no longer counts, even before
 * its status is updated.
 */
export async function loadBusy(tx: Tx, query: BusyQuery): Promise<Interval[]> {
  const { businessId, rules, startsAt, endsAt, now, exceptConversationId } = query;
  const margin = (rules.buffers.beforeMinutes + rules.buffers.afterMinutes) * MINUTE_MS;
  const overlaps = {
    startsAt: { lt: new Date(endsAt.getTime() + margin) },
    endsAt: { gt: new Date(startsAt.getTime() - margin) },
  };
  const select = { startsAt: true, endsAt: true };
  const [holds, bookings] = await Promise.all([
    tx.hold.findMany({
      where: {
        businessId,
        status: HoldStatus.active,
        expiresAt: { gt: now },
        conversationId: { not: exceptConversationId },
        ...overlaps,
      },
      select,
    }),
    tx.booking.findMany({ where: { businessId, status: { in: OCCUPYING }, ...overlaps }, select }),
  ]);
  return [...holds, ...bookings];
}

/** The lowest lane free for this time, or null when every lane is taken. */
export async function freeLane(tx: Tx, businessId: string, capacity: number, slot: Interval) {
  const taken = await tx.booking.findMany({
    where: {
      businessId,
      status: { in: OCCUPYING },
      startsAt: { lt: slot.endsAt },
      endsAt: { gt: slot.startsAt },
    },
    select: { lane: true },
  });
  const used = new Set(taken.map((b) => b.lane));
  const lane = Array.from({ length: capacity }, (_, i) => i).find((i) => !used.has(i));
  return lane ?? null;
}
