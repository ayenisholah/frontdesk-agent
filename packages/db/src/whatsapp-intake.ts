import type { AcceptInbound, InboundMessage, IntakeResult } from "@frontdesk/channels";
import type { Db, Tx } from "./client";
import { Prisma } from "./generated/client";
import type { Clock } from "./slots";

async function checkDuplicate(
  tx: Tx,
  businessId: string,
  message: InboundMessage,
): Promise<IntakeResult | null> {
  const existing = await tx.message.findFirst({
    where: {
      channel: "whatsapp",
      providerMessageId: message.providerMessageId,
      conversation: { businessId },
    },
    include: { conversation: { include: { customer: true } }, inboundWork: true },
  });
  if (!existing) return null;
  const same =
    existing.conversation.customer.phone === message.phone &&
    existing.body === message.body &&
    existing.inboundWork?.phoneNumberId === message.phoneNumberId;
  return same ? "duplicate" : "conflict";
}

async function conversationFor(
  tx: Tx,
  businessId: string,
  message: InboundMessage,
  receivedAt: Date,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-customer:${businessId}:${message.phone}`}::text, 0))`;
  const customer = await tx.customer.upsert({
    where: { businessId_phone: { businessId, phone: message.phone } },
    create: { businessId, phone: message.phone, channel: "whatsapp" },
    update: {},
  });
  const existing = await tx.conversation.findFirst({
    where: { businessId, customerId: customer.id, channel: "whatsapp", status: { not: "closed" } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const windowAt = new Date(Math.min(receivedAt.getTime(), message.providerTimestamp.getTime()));
  if (!existing)
    return tx.conversation.create({
      data: {
        businessId,
        customerId: customer.id,
        channel: "whatsapp",
        lastCustomerMessageAt: windowAt,
      },
    });
  if (!existing.lastCustomerMessageAt || existing.lastCustomerMessageAt < windowAt) {
    await tx.conversation.updateMany({
      where: { id: existing.id, businessId },
      data: { lastCustomerMessageAt: windowAt },
    });
  }
  return existing;
}

async function persist(tx: Tx, businessId: string, incoming: InboundMessage, receivedAt: Date) {
  const conversation = await conversationFor(tx, businessId, incoming, receivedAt);
  const message = await tx.message.create({
    data: {
      conversationId: conversation.id,
      channel: "whatsapp",
      direction: "inbound",
      author: "customer",
      providerMessageId: incoming.providerMessageId,
      body: incoming.body,
      createdAt: receivedAt,
    },
  });
  await tx.inboundWork.create({
    data: {
      businessId,
      messageId: message.id,
      phoneNumberId: incoming.phoneNumberId,
      kind: incoming.kind,
      providerTimestamp: incoming.providerTimestamp,
      receivedAt,
    },
  });
}

/** Acknowledgement is safe only after this transaction commits. Queue dispatch is separate. */
export function createWhatsAppIntake(db: Db, clock: Clock): AcceptInbound {
  return async (message) => {
    try {
      return await db.$transaction(async (tx): Promise<IntakeResult> => {
        const registration = await tx.whatsAppRegistration.findUnique({
          where: { phoneNumberId: message.phoneNumberId },
        });
        if (!registration) return "unregistered";
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`whatsapp-message:${message.providerMessageId}`}::text, 0))`;
        const duplicate = await checkDuplicate(tx, registration.businessId, message);
        if (duplicate) return duplicate;
        await persist(tx, registration.businessId, message, clock());
        return "accepted";
      });
    } catch (error) {
      // A provider ID already owned by another tenant fails the unique constraint.
      // The failed transaction rolls back without reading foreign message content.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        return "conflict";
      throw error;
    }
  };
}
