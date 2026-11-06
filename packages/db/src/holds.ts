// Holds: a short claim on a slot while the customer decides or pays.
import type { Db, Tx } from "./client";
import { BookingStatus, HoldStatus } from "./generated/enums";
import { canClaim, withSlotLock, type Clock } from "./slots";

const HOLD_MINUTES = 15;
const MINUTE_MS = 60_000;

export type HoldRequest = {
  businessId: string;
  conversationId: string;
  /** The service's stable key from config. */
  serviceKey: string;
  startsAt: Date;
  clock: Clock;
};

export type HoldResult =
  | { ok: true; hold: { id: string; startsAt: Date; endsAt: Date; expiresAt: Date } }
  | { ok: false; reason: "conversation_not_found" | "service_not_found" | "slot_unavailable" };

/**
 * Holds a slot for 15 minutes, replacing the conversation's current hold. The engine
 * re-validates the time, so an invented slot is refused. A refusal keeps the existing hold.
 */
export function placeHold(db: Db, request: HoldRequest): Promise<HoldResult> {
  return withSlotLock(db, request.businessId, request.clock, (tx, now) =>
    placeHoldInTransaction(tx, request, now),
  );
}

/** Used by replay-safe agent mutations inside the same slot transaction. */
export async function placeHoldInTransaction(
  tx: Tx,
  request: Omit<HoldRequest, "clock">,
  now: Date,
): Promise<HoldResult> {
  const { businessId, conversationId, serviceKey, startsAt } = request;
  const conversation = await tx.conversation.findFirst({
    where: { id: conversationId, businessId },
  });
  if (!conversation) return { ok: false, reason: "conversation_not_found" };
  const service = await tx.service.findFirst({
    where: { businessId, key: serviceKey, active: true },
  });
  if (!service) return { ok: false, reason: "service_not_found" };

  const endsAt = new Date(startsAt.getTime() + service.durationMinutes * MINUTE_MS);
  const claim = {
    businessId,
    service,
    startsAt,
    endsAt,
    now,
    exceptConversationId: conversationId,
  };
  if (!(await canClaim(tx, claim))) return { ok: false, reason: "slot_unavailable" };

  await tx.hold.updateMany({
    where: { conversationId, status: HoldStatus.active },
    data: { status: HoldStatus.released },
  });
  const hold = await tx.hold.create({
    data: {
      businessId,
      conversationId,
      serviceId: service.id,
      startsAt,
      endsAt,
      expiresAt: new Date(now.getTime() + HOLD_MINUTES * MINUTE_MS),
    },
    select: { id: true, startsAt: true, endsAt: true, expiresAt: true },
  });
  return { ok: true, hold };
}

/**
 * Expires stale holds and unpaid bookings, and returns the conversations affected so the
 * customer can be told. Runs across all businesses, as a scheduled job.
 */
export function releaseExpired(db: Db, now: Date): Promise<string[]> {
  return db.$transaction(async (tx) => {
    const staleHold = { status: HoldStatus.active, expiresAt: { lte: now } };
    const unpaid = { status: BookingStatus.pending_deposit, depositDueAt: { lte: now } };
    const holds = await tx.hold.findMany({ where: staleHold, select: { conversationId: true } });
    const bookings = await tx.booking.findMany({
      where: unpaid,
      select: { hold: { select: { conversationId: true } } },
    });
    await tx.hold.updateMany({ where: staleHold, data: { status: HoldStatus.expired } });
    await tx.booking.updateMany({
      where: unpaid,
      data: { status: BookingStatus.cancelled, cancelledAt: now },
    });
    const ids = [...holds, ...bookings.map((b) => b.hold!)].map((row) => row.conversationId);
    return [...new Set(ids)];
  });
}
