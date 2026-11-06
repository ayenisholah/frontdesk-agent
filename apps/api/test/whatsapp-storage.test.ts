import { createHmac, randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createWhatsAppIntake, registerWhatsAppNumber } from "@frontdesk/db";
import { createApp } from "../src/app.js";
import { agentFixture, AGENT_NOW } from "../../../packages/db/test/agent-fixture";
import { baseUrl, useTestDatabase } from "../../../packages/db/test/test-db";

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
describe.skipIf(!baseUrl)("signed webhook storage integration", () => {
  const database = useTestDatabase();
  it("retries a partially committed batch without duplicating earlier messages", async () => {
    const db = database.db();
    const first = await agentFixture(db);
    const other = await agentFixture(db);
    await registerWhatsAppNumber(db, { businessId: first.scope.businessId, phoneNumberId: "100" });
    const app = createApp({
      checks: {},
      log,
      release: "test",
      whatsapp: {
        appSecret: "fictional",
        verifyToken: "token",
        accept: createWhatsAppIntake(db, () => AGENT_NOW),
      },
    });
    const payload = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: ["100", "200"].map((phoneNumberId) => ({
            field: "messages",
            value: {
              metadata: { phone_number_id: phoneNumberId },
              messages: [
                {
                  id: randomUUID(),
                  from: "12025550100",
                  timestamp: String(AGENT_NOW.getTime() / 1000),
                  type: "text",
                  text: { body: "Fictional message" },
                },
              ],
            },
          })),
        },
      ],
    });
    const send = () =>
      request(app)
        .post("/webhooks/whatsapp")
        .set("Content-Type", "application/json")
        .set(
          "X-Hub-Signature-256",
          `sha256=${createHmac("sha256", "fictional").update(payload).digest("hex")}`,
        )
        .send(payload);
    expect((await send()).status).toBe(503);
    expect(await db.inboundWork.count()).toBe(1);
    await registerWhatsAppNumber(db, { businessId: other.scope.businessId, phoneNumberId: "200" });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const rows = await db.inboundWork.findMany({
      orderBy: { sequence: "asc" },
      include: { message: { include: { conversation: true } } },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.businessId)).toEqual([first.scope.businessId, other.scope.businessId]);
    expect(rows.every((r) => r.message.conversation.businessId === r.businessId)).toBe(true);
  });
});
