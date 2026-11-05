// Shared by every write that claims time. See docs/adr/0010-booking-concurrency.md.
import { formatMinuteOfDay, isSlotAvailable, type Interval } from "@frontdesk/core";
import type { Db, Tx } from "./client";
import { BookingStatus, HoldStatus } from "./generated/enums";

const MINUTE_MS = 60_000;

/** Statuses that occupy time. Must match the Booking_no_lane_overlap constraint. */
export const OCCUPYING: BookingStatus[] = [BookingStatus.pending_deposit, BookingStatus.confirmed];

/** Reads the current time. A function, so it's read after the lock wait, not before it. */
export type Clock = () => Date;

/** Serialises slot changes for one business until the transaction ends. */
export async function lockSlots(tx: Tx, businessId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${businessId}::text, 0))`;
}

/**
 * Runs `work` holding the business's slot lock, with the time read once the lock is held.
 * Overdue unpaid bookings give up their slots first, so every claim sees them as free.
 */
export function withSlotLock<T>(
  db: Db,
  businessId: string,
  clock: Clock,
  work: (tx: Tx, now: Date) => Promise<T>,
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await lockSlots(tx, businessId);
      const now = clock();
      await tx.booking.updateMany({
        where: { businessId, status: BookingStatus.pending_deposit, depositDueAt: { lte: now } },
        data: { status: BookingStatus.cancelled, cancelledAt: now },
      });
      return work(tx, now);
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}

/** The availability rules for a business, in the shape the engine expects. */
async function loadRules(tx: Tx, businessId: string) {
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

type BusyQuery = {
  businessId: string;
  rules: Rules;
  startsAt: Date;
  endsAt: Date;
  now: Date;
  /** Ignore this conversation's hold, so a replacement can reuse its own time. */
  exceptConversationId?: string;
  /** Ignore this booking, so a move can overlap its own old time. */
  exceptBookingId?: string;
};

/**
 * Time already taken around a slot. An expired hold no longer counts, even before
 * its status is updated.
 */
async function loadBusy(tx: Tx, query: BusyQuery): Promise<Interval[]> {
  const { businessId, rules, startsAt, endsAt, now, exceptConversationId, exceptBookingId } = query;
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
    tx.booking.findMany({
      where: { businessId, status: { in: OCCUPYING }, id: { not: exceptBookingId }, ...overlaps },
      select,
    }),
  ]);
  return [...holds, ...bookings];
}

export type Claim = Omit<BusyQuery, "rules"> & { service: { durationMinutes: number } };

/** The one check every claim goes through: the engine, with rules and busy time read under the lock. */
export async function canClaim(tx: Tx, { service, ...query }: Claim): Promise<boolean> {
  const rules = await loadRules(tx, query.businessId);
  const busy = await loadBusy(tx, { ...query, rules });
  return isSlotAvailable({
    config: rules,
    service,
    now: query.now,
    busy,
    startsAt: query.startsAt,
  });
}

/** The lowest lane free for this time, or null when every lane is taken. */
export async function freeLane(
  tx: Tx,
  businessId: string,
  capacity: number,
  slot: Interval & { exceptBookingId?: string },
) {
  const taken = await tx.booking.findMany({
    where: {
      businessId,
      status: { in: OCCUPYING },
      id: { not: slot.exceptBookingId },
      startsAt: { lt: slot.endsAt },
      endsAt: { gt: slot.startsAt },
    },
    select: { lane: true },
  });
  const used = new Set(taken.map((b) => b.lane));
  const lane = Array.from({ length: capacity }, (_, i) => i).find((i) => !used.has(i));
  return lane ?? null;
}
