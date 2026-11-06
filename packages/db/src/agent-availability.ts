import { findSlots } from "@frontdesk/core";
import type { AvailabilityInput, Slot } from "@frontdesk/agent";
import type { Db } from "./client";
import { loadBusinessConfig } from "./business";
import { scopedConversation, type AgentScope } from "./agent-scope";
import { withSlotLock, type Clock } from "./slots";

export function agentAvailability(
  db: Db,
  scope: AgentScope,
  clock: Clock,
  input: AvailabilityInput,
): Promise<Slot[]> {
  return withSlotLock(db, scope.businessId, clock, async (tx, now) => {
    const conversation = await scopedConversation(tx, scope);
    const config = (await loadBusinessConfig(tx, conversation.business.slug))!;
    const service = config.services.find((s) => s.id === input.serviceKey);
    if (!service) return [];
    const [holds, bookings] = await Promise.all([
      tx.hold.findMany({
        where: {
          businessId: scope.businessId,
          status: "active",
          expiresAt: { gt: now },
          conversationId: { not: scope.conversationId },
        },
      }),
      tx.booking.findMany({
        where: { businessId: scope.businessId, status: { in: ["pending_deposit", "confirmed"] } },
      }),
    ]);
    return findSlots({
      config,
      service,
      now,
      busy: [...holds, ...bookings],
      from: new Date(input.from),
      to: new Date(input.to),
    })
      .slice(0, 6)
      .map((s) => ({ startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() }));
  });
}
