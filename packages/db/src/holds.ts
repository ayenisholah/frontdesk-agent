// Holds: a short claim on a slot while the customer decides or pays.
import { isSlotAvailable } from "@frontdesk/core";
import type { Db } from "./client";
import { HoldStatus } from "./generated/enums";
import { loadBusy, loadRules, withSlotLock } from "./slots";

const HOLD_MINUTES = 15;
const MINUTE_MS = 60_000;

export type HoldRequest = {
  businessId: string;
  conversationId: string;
  /** The service's stable key from config. */
  serviceKey: string;
  startsAt: Date;
  now: Date;
};

export type HoldResult =
  | { ok: true; hold: { id: string; startsAt: Date; endsAt: Date; expiresAt: Date } }
  | { ok: false; reason: "conversation_not_found" | "service_not_found" | "slot_unavailable" };

/**
 * Holds a slot for 15 minutes, replacing the conversation's current hold. The engine
 * re-validates the time, so an invented slot is refused. A refusal keeps the existing hold.
 */
export function placeHold(db: Db, request: HoldRequest): Promise<HoldResult> {
  const { businessId, conversationId, serviceKey, startsAt, now } = request;
  return withSlotLock(db, businessId, async (tx) => {
    const conversation = await tx.conversation.findFirst({
      where: { id: conversationId, businessId },
    });
    if (!conversation) return { ok: false, reason: "conversation_not_found" };
    const service = await tx.service.findFirst({
      where: { businessId, key: serviceKey, active: true },
    });
    if (!service) return { ok: false, reason: "service_not_found" };

    const rules = await loadRules(tx, businessId);
    const endsAt = new Date(startsAt.getTime() + service.durationMinutes * MINUTE_MS);
    const busy = await loadBusy(tx, {
      businessId,
      rules,
      startsAt,
      endsAt,
      now,
      exceptConversationId: conversationId,
    });
    if (!isSlotAvailable({ config: rules, service, now, busy, startsAt })) {
      return { ok: false, reason: "slot_unavailable" };
    }

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
  });
}

/** Marks stale holds expired and returns how many changed. */
export async function expireHolds(db: Db, now: Date): Promise<number> {
  const { count } = await db.hold.updateMany({
    where: { status: HoldStatus.active, expiresAt: { lte: now } },
    data: { status: HoldStatus.expired },
  });
  return count;
}
