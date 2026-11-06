import { harborPaws } from "@frontdesk/core";
import type { Db } from "./client";
import type { Clock } from "./slots";
import { saveBusinessConfig } from "./business";
import { scopedConversation, type AgentScope } from "./agent-scope";

export async function openSandbox(
  db: Db,
  options: { fixture: string; name: string; conversationId?: string },
): Promise<AgentScope> {
  if (options.fixture !== "harbor-paws") throw new Error("Unknown fixture");
  if (!/^(cli|eval)-[a-z0-9-]+$/.test(options.name)) throw new Error("Invalid sandbox name");
  if (options.conversationId) {
    const row = await db.conversation.findFirst({
      where: { id: options.conversationId, business: { slug: { startsWith: "sandbox-cli-" } } },
    });
    if (!row) throw new Error("Sandbox unavailable");
    return { businessId: row.businessId, customerId: row.customerId, conversationId: row.id };
  }
  const businessId = await saveBusinessConfig(db, {
    ...harborPaws,
    slug: `sandbox-${options.name}`,
  });
  const customer = await db.customer.upsert({
    where: { businessId_phone: { businessId, phone: "+12025550100" } },
    create: { businessId, phone: "+12025550100", name: "Demo customer", channel: "whatsapp" },
    update: {},
  });
  const conversation = await db.conversation.create({
    data: { businessId, customerId: customer.id, channel: "whatsapp" },
  });
  return { businessId, customerId: customer.id, conversationId: conversation.id };
}

export async function appendSandboxMessage(
  db: Db,
  scope: AgentScope,
  text: string,
  clock: Clock,
): Promise<string> {
  const body = text.trim();
  if (!body || body.length > 5000) throw new Error("Invalid message");
  return db.$transaction(async (tx) => {
    const conversation = await scopedConversation(tx, scope);
    if (!conversation.business.slug.startsWith("sandbox-")) throw new Error("Sandbox unavailable");
    const now = clock();
    const message = await tx.message.create({
      data: {
        conversationId: scope.conversationId,
        channel: conversation.channel,
        direction: "inbound",
        author: "customer",
        body,
        createdAt: now,
      },
    });
    await tx.conversation.update({
      where: { id: scope.conversationId, businessId: scope.businessId },
      data: { lastCustomerMessageAt: now },
    });
    return message.id;
  });
}
