// Bookings: created from a valid hold, and confirmed later by the payment webhook (GR-3).
import type { Db } from "./client";
import { HoldStatus } from "./generated/enums";
import { freeLane, withSlotLock } from "./slots";

export type BookRequest = { businessId: string; holdId: string; now: Date };

export type BookResult =
  | { ok: true; booking: { id: string; startsAt: Date; endsAt: Date; depositCents: number } }
  | { ok: false; reason: "hold_not_valid" | "slot_unavailable" };

/** Turns an unexpired hold into a pending_deposit booking, at the price in config right now. */
export function bookFromHold(
  db: Db,
  { businessId, holdId, now }: BookRequest,
): Promise<BookResult> {
  return withSlotLock(db, businessId, async (tx) => {
    const hold = await tx.hold.findFirst({
      where: { id: holdId, businessId, status: HoldStatus.active, expiresAt: { gt: now } },
      include: { service: true, conversation: true, business: true },
    });
    if (!hold) return { ok: false, reason: "hold_not_valid" };

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
        priceCents: hold.service.priceCents,
        depositCents: hold.service.depositCents,
      },
      select: { id: true, startsAt: true, endsAt: true, depositCents: true },
    });
    return { ok: true, booking };
  });
}
