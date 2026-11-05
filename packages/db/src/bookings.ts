// Bookings: created from a valid hold, and confirmed later by the payment webhook (GR-3).
import { canChangeBooking } from "@frontdesk/core";
import type { Db, Tx } from "./client";
import { BookingStatus, HoldStatus } from "./generated/enums";
import { canClaim, freeLane, OCCUPYING, withSlotLock, type Clock } from "./slots";

const MINUTE_MS = 60_000;

export type BookRequest = { businessId: string; holdId: string; clock: Clock };

export type BookResult =
  | { ok: true; booking: { id: string; startsAt: Date; endsAt: Date; depositCents: number } }
  | { ok: false; reason: "hold_not_valid" | "slot_unavailable" };

/**
 * Turns an unexpired hold into a pending_deposit booking, at the price in config right now.
 * The engine checks the slot again, because hours or capacity may have changed since the hold.
 * The deposit is due when the hold would have expired.
 */
export function bookFromHold(
  db: Db,
  { businessId, holdId, clock }: BookRequest,
): Promise<BookResult> {
  return withSlotLock(db, businessId, clock, async (tx, now) => {
    const hold = await tx.hold.findFirst({
      where: { id: holdId, businessId, status: HoldStatus.active, expiresAt: { gt: now } },
      include: { service: true, conversation: true, business: true },
    });
    if (!hold) return { ok: false, reason: "hold_not_valid" };

    const { startsAt, endsAt, service, conversationId } = hold;
    const claim = {
      businessId,
      service,
      startsAt,
      endsAt,
      now,
      exceptConversationId: conversationId,
    };
    if (!(await canClaim(tx, claim))) return { ok: false, reason: "slot_unavailable" };

    const lane = await freeLane(tx, businessId, hold.business.capacity, hold);
    if (lane === null) return { ok: false, reason: "slot_unavailable" };

    await tx.hold.update({ where: { id: hold.id }, data: { status: HoldStatus.converted } });
    const booking = await tx.booking.create({
      data: {
        businessId,
        customerId: hold.conversation.customerId,
        serviceId: hold.serviceId,
        holdId: hold.id,
        startsAt: hold.startsAt,
        endsAt: hold.endsAt,
        lane,
        depositDueAt: hold.expiresAt,
        priceCents: hold.service.priceCents,
        depositCents: hold.service.depositCents,
      },
      select: { id: true, startsAt: true, endsAt: true, depositCents: true },
    });
    return { ok: true, booking };
  });
}

export type ChangeRequest = {
  businessId: string;
  bookingId: string;
  customerId: string;
  clock: Clock;
};

type Refusal =
  | { ok: false; reason: "booking_not_found" | "not_customers_booking" }
  | { ok: false; reason: "outside_policy"; policy: string };

export type CancelResult = { ok: true } | Refusal;

export type RescheduleResult =
  | { ok: true; booking: { startsAt: Date; endsAt: Date } }
  | Refusal
  | { ok: false; reason: "slot_unavailable" };

/** Loads an active booking and applies the rules shared by cancelling and moving (FR-BK-4). */
async function loadChangeable(
  tx: Tx,
  { businessId, bookingId, customerId }: ChangeRequest,
  now: Date,
) {
  const booking = await tx.booking.findFirst({
    where: { id: bookingId, businessId, status: { in: OCCUPYING } },
    include: { business: true, service: true },
  });
  if (!booking) return { ok: false, reason: "booking_not_found" } as const;
  if (booking.customerId !== customerId)
    return { ok: false, reason: "not_customers_booking" } as const;
  const decision = canChangeBooking({
    startsAt: booking.startsAt,
    now,
    windowHours: booking.business.cancellationWindowHours,
  });
  if (!decision.allowed)
    return { ok: false, reason: "outside_policy", policy: decision.policy } as const;
  return { ok: true, booking } as const;
}

/** Cancels a booking for its own customer, inside the policy. Frees the slot at once. */
export function cancelBooking(db: Db, request: ChangeRequest): Promise<CancelResult> {
  return withSlotLock(db, request.businessId, request.clock, async (tx, now) => {
    const found = await loadChangeable(tx, request, now);
    if (!found.ok) return found;
    await tx.booking.update({
      where: { id: found.booking.id },
      data: { status: BookingStatus.cancelled, cancelledAt: now },
    });
    return { ok: true };
  });
}

/** Moves a booking to a new engine-approved slot. The old time is free as soon as this commits. */
export function rescheduleBooking(
  db: Db,
  request: ChangeRequest & { startsAt: Date },
): Promise<RescheduleResult> {
  const { businessId, bookingId, startsAt, clock } = request;
  return withSlotLock(db, businessId, clock, async (tx, now) => {
    const found = await loadChangeable(tx, request, now);
    if (!found.ok) return found;
    const { service, business } = found.booking;
    const endsAt = new Date(startsAt.getTime() + service.durationMinutes * MINUTE_MS);
    const claim = { businessId, service, startsAt, endsAt, now, exceptBookingId: bookingId };
    if (!(await canClaim(tx, claim))) return { ok: false, reason: "slot_unavailable" };
    const slot = { startsAt, endsAt, exceptBookingId: bookingId };
    const lane = await freeLane(tx, businessId, business.capacity, slot);
    if (lane === null) return { ok: false, reason: "slot_unavailable" };
    await tx.booking.update({ where: { id: bookingId }, data: { startsAt, endsAt, lane } });
    return { ok: true, booking: { startsAt, endsAt } };
  });
}
