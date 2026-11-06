import type { ChatMessage, ConversationSnapshot } from "@frontdesk/agent";
import type { Tx } from "./client";
import { loadBusinessConfig } from "./business";
import { scopedConversation, type AgentScope } from "./agent-scope";

export async function loadSnapshot(
  tx: Tx,
  scope: AgentScope,
  trigger: { id: string; createdAt: Date },
  now: Date,
): Promise<ConversationSnapshot> {
  const conversation = await scopedConversation(tx, scope);
  const config = (await loadBusinessConfig(tx, conversation.business.slug))!;
  const messages = await loadMessages(tx, scope, trigger);
  const activeHold = await tx.hold.findFirst({
    where: {
      businessId: scope.businessId,
      conversationId: scope.conversationId,
      status: "active",
      expiresAt: { gt: now },
    },
    include: { service: true },
  });
  const booking = await tx.booking.findFirst({
    where: {
      businessId: scope.businessId,
      customerId: scope.customerId,
      status: { in: ["pending_deposit", "confirmed"] },
    },
    orderBy: { startsAt: "asc" },
    include: { service: true },
  });
  return {
    config,
    messages,
    customerName: conversation.customer.name,
    activeHold: activeHold
      ? {
          startsAt: activeHold.startsAt.toISOString(),
          endsAt: activeHold.endsAt.toISOString(),
          serviceKey: activeHold.service.key,
          expiresAt: activeHold.expiresAt.toISOString(),
        }
      : null,
    booking: booking
      ? {
          startsAt: booking.startsAt.toISOString(),
          endsAt: booking.endsAt.toISOString(),
          serviceKey: booking.service.key,
          status: booking.status,
        }
      : null,
  };
}

async function loadMessages(tx: Tx, scope: AgentScope, trigger: { id: string; createdAt: Date }) {
  const rows = await tx.message.findMany({
    where: {
      conversationId: scope.conversationId,
      conversation: { businessId: scope.businessId },
      OR: [
        { createdAt: { lt: trigger.createdAt } },
        { createdAt: trigger.createdAt, id: { lte: trigger.id } },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
  });
  const messages: ChatMessage[] = rows
    .reverse()
    .map((m) =>
      m.author === "customer"
        ? { role: "user", text: m.body }
        : { role: "assistant", text: m.body, toolCalls: [] },
    );
  return messages.slice(
    Math.max(
      0,
      messages.findIndex((m) => m.role === "user"),
    ),
  );
}
