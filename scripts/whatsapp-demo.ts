import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "@frontdesk/api";
import {
  createQueues,
  createAgentWorker,
  createOutboundProcessor,
  dispatchInbox,
  dispatchOutbound,
} from "@frontdesk/worker";
import {
  createDb,
  openSandbox,
  registerWhatsAppNumber,
  configureWhatsAppDelivery,
  createWhatsAppIntake,
  createWhatsAppStatusIntake,
  createInboxStore,
  createDeliveryStore,
} from "@frontdesk/db";
import type { ModelClient } from "@frontdesk/agent";

const secret = "fictional-local-demo-secret";
const phone = "12025550100";
const clock = () => new Date();
function localUrl(value: string | undefined) {
  if (!value || !["localhost", "127.0.0.1", "postgres", "redis"].includes(new URL(value).hostname))
    throw new Error("Demo requires local dependencies");
  return value;
}
async function post(url: string, phoneNumberId: string, content: object) {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: { metadata: { phone_number_id: phoneNumberId }, ...content },
          },
        ],
      },
    ],
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    },
    body,
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Demo webhook failed");
  await response.text();
}
async function waitFor(predicate: () => Promise<boolean>) {
  for (let n = 0; n < 100; n++) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error("Demo timed out");
}
function fakeModel(): ModelClient {
  return {
    complete: () =>
      Promise.resolve({
        text: '{"category":"customer_request","language":"english"}',
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
  };
}
async function main() {
  const database = localUrl(process.env.DATABASE_URL);
  const redis = localUrl(process.env.REDIS_URL);
  const db = createDb(database);
  const queues = createQueues({ url: redis, prefix: `demo-${randomUUID()}`, report: () => {} });
  let businessId: string | undefined;
  const app = createApp({
    checks: {},
    release: "fictional",
    log: { info() {}, warn() {}, error() {}, debug() {} },
    whatsapp: {
      appSecret: secret,
      verifyToken: secret,
      accept: createWhatsAppIntake(db, clock),
      acceptStatus: createWhatsAppStatusIntake(db, clock),
    },
  });
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const scope = await openSandbox(db, { fixture: "harbor-paws", name: `cli-${randomUUID()}` });
    businessId = scope.businessId;
    const sender = String(BigInt(`0x${randomUUID().replaceAll("-", "").slice(0, 16)}`));
    await registerWhatsAppNumber(db, { businessId, phoneNumberId: sender });
    await configureWhatsAppDelivery(db, {
      businessId,
      phoneNumberId: sender,
      credentialEnv: "WHATSAPP_DEMO_TOKEN",
      graphVersion: "v23.0",
      ownerPhone: "+12025550199",
      templates: {
        owner: { name: "fictional_alert", language: "en", verifiedAt: clock().toISOString() },
      },
    });
    await runDemo({
      db,
      queues,
      businessId,
      sender,
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhooks/whatsapp`,
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await queues.close();
    const cleanup = createQueues({
      url: redis,
      prefix: queues.inbound.opts.prefix!,
      report: () => {},
    });
    try {
      await cleanup.inbound.waitUntilReady();
      await Promise.all([
        cleanup.inbound.obliterate({ force: true }),
        cleanup.outbound.obliterate({ force: true }),
        cleanup.dead.obliterate({ force: true }),
      ]);
    } finally {
      await cleanup.close();
    }
    if (businessId) await db.business.delete({ where: { id: businessId } });
    await db.$disconnect();
  }
}
async function runDemo({
  db,
  queues,
  businessId,
  sender,
  url,
}: {
  db: ReturnType<typeof createDb>;
  queues: ReturnType<typeof createQueues>;
  businessId: string;
  sender: string;
  url: string;
}) {
  const model = fakeModel();
  const config = {
    region: "eu-west-1" as const,
    modelId: "eu.fixture",
    smallModelId: "eu.fixture",
    rates: {
      version: "fictional",
      models: { "eu.fixture": { inputMicrosPerToken: 1, outputMicrosPerToken: 1 } },
    },
  };
  queues.worker(
    createAgentWorker({ db, clock, model, classifier: model, config, report: () => {} }),
  );
  queues.outboundWorker(
    createOutboundProcessor({
      store: (id) => createDeliveryStore(db, id, clock),
      limit: queues.limit,
      send: () => Promise.resolve({ state: "accepted", providerMessageId: "wamid.fictional" }),
    }),
  );
  const message = {
    id: `demo-${randomUUID()}`,
    from: phone,
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: "text",
    text: { body: "Please ask the owner to help." },
  };
  await post(url, sender, { messages: [message] });
  await post(url, sender, { messages: [message] });
  await queues.inbound.waitUntilReady();
  await dispatchInbox(createInboxStore(db, businessId, clock), queues.inbound);
  await waitFor(async () => (await db.outboundWork.count({ where: { businessId } })) === 1);
  await dispatchOutbound(createDeliveryStore(db, businessId, clock), queues.outbound);
  await waitFor(
    async () =>
      (await db.outboundWork.findFirst({ where: { businessId, state: "accepted" } })) !== null,
  );
  await post(url, sender, {
    statuses: [
      {
        id: "wamid.fictional",
        recipient_id: phone,
        timestamp: String(Math.floor(Date.now() / 1000)),
        status: "delivered",
      },
    ],
  });
  const result = await db.outboundWork.findFirstOrThrow({ where: { businessId } });
  console.log(
    JSON.stringify({
      mode: "fictional",
      inbound: await db.inboundWork.count({ where: { businessId } }),
      replies: await db.outboundWork.count({ where: { businessId } }),
      delivery: result.state,
    }),
  );
}
main().catch(() => {
  console.error(JSON.stringify({ event: "fictional_demo_failed" }));
  process.exitCode = 1;
});
