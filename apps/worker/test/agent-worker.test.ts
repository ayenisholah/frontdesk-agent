import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createInboxStore, createWhatsAppIntake, registerWhatsAppNumber } from "@frontdesk/db";
import { createAgentWorker } from "../src/agent-worker";
import { agentFixture, AGENT_NOW } from "../../../packages/db/test/agent-fixture";
import { baseUrl, useTestDatabase } from "../../../packages/db/test/test-db";

describe.skipIf(!baseUrl)("agent worker integration", () => {
  const database = useTestDatabase();
  it("persists one handoff reply on duplicate job delivery", async () => {
    const db = database.db();
    const { scope } = await agentFixture(db);
    await registerWhatsAppNumber(db, { businessId: scope.businessId, phoneNumberId: "7070" });
    await createWhatsAppIntake(
      db,
      () => AGENT_NOW,
    )({
      phoneNumberId: "7070",
      providerMessageId: randomUUID(),
      phone: "+12025550190",
      providerTimestamp: AGENT_NOW,
      kind: "text",
      body: "Owner please",
    });
    const complete = vi.fn().mockResolvedValue({
      text: '{"category":"customer_request","language":"english"}',
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const process = createAgentWorker({
      db,
      clock: () => AGENT_NOW,
      model: { complete },
      classifier: { complete },
      report: vi.fn(),
      config: {
        region: "eu-west-1",
        modelId: "eu.fake",
        smallModelId: "eu.fake",
        rates: {
          version: "test",
          models: { "eu.fake": { inputMicrosPerToken: 1, outputMicrosPerToken: 1 } },
        },
      },
    });
    const ref = (await createInboxStore(db, scope.businessId, () => AGENT_NOW).listDue())[0]!;
    await process(ref);
    await process(ref);
    expect(complete).toHaveBeenCalledOnce();
    const reply = await db.outboundWork.findFirstOrThrow({
      where: { businessId: scope.businessId },
      include: { message: { include: { conversation: true } } },
    });
    expect(reply.allowOwner).toBe(true);
    expect(reply.message.conversation.status).toBe("owner");
    expect(await db.outboundWork.count({ where: { businessId: scope.businessId } })).toBe(1);
  });
});
