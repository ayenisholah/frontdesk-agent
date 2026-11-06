import { harborPaws } from "@frontdesk/core";
import { saveBusinessConfig, type Db } from "../src/index";

export const AGENT_NOW = new Date("2031-03-03T08:00:00Z");
let serial = 0;
export async function agentFixture(db: Db) {
  const config = {
    ...structuredClone(harborPaws),
    slug: `agent-${++serial}`,
    timezone: "UTC",
    buffers: { beforeMinutes: 0, afterMinutes: 0 },
    openingHours: [{ weekday: 1, open: "09:00", close: "17:00" }],
  };
  const businessId = await saveBusinessConfig(db, config);
  const customer = await db.customer.create({
    data: { businessId, phone: "+15550001000", channel: "whatsapp" },
  });
  const conversation = await db.conversation.create({
    data: { businessId, customerId: customer.id, channel: "whatsapp" },
  });
  const message = await db.message.create({
    data: {
      conversationId: conversation.id,
      direction: "inbound",
      author: "customer",
      channel: "whatsapp",
      body: "A bath please",
    },
  });
  const run = await db.agentRun.create({
    data: {
      conversationId: conversation.id,
      triggerMessageId: message.id,
      model: "fake",
      promptVersion: "test",
    },
  });
  const scope = { businessId, conversationId: conversation.id, customerId: customer.id };
  const input = { serviceKey: config.services[0]!.id, startsAt: "2031-03-03T10:00:00Z" };
  return { config, scope, input, runId: run.id, messageId: message.id };
}
