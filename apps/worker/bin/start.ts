import { createServer } from "node:http";
import {
  createTelemetry,
  parseTelemetryConfig,
  resolveRuntimeEnvironment,
} from "@frontdesk/runtime";
import { createBedrockClient, parseAgentConfig } from "@frontdesk/agent";
import { createWhatsAppSender } from "@frontdesk/channels";
import {
  createDb,
  createInboxStore,
  createDeliveryStore,
  redactBusinessContent,
} from "@frontdesk/db";
import {
  createQueues,
  createAgentWorker,
  createOutboundProcessor,
  dispatchInbox,
  dispatchOutbound,
  dispatchDead,
} from "../src/index";
import { parseWorkerConfig } from "../src/config";
import { createRuntime } from "../src/runtime";
import { createSweep } from "../src/sweep";
import { createWorkerHealth } from "../src/health";

function main() {
  const settings = parseWorkerConfig(resolveRuntimeEnvironment(process.env));
  const config = settings.inbound ? parseAgentConfig(process.env) : undefined;
  const db = createDb(settings.database);
  const controller = new AbortController();
  const telemetry = workerTelemetry(db, () => queues.ping());
  const queues = createQueues({
    url: settings.redis,
    prefix: settings.prefix,
    report: () => health.report("queue_failed"),
  });
  const health = createWorkerHealth(
    async () => {
      await Promise.all([db.$queryRaw`SELECT 1`, queues.ping()]);
    },
    controller.signal,
    (event) => telemetry?.report(event),
  );
  const sweep = connectProcessing({ settings, config, db, controller, queues, health });
  const runtime = createRuntime({
    report: (event) => health.report(event),
    dispatch: async () => {
      if (settings.inbound || settings.outbound) await sweep.dispatch();
    },
    retain: async () => {
      if (settings.retention) await sweep.retain();
    },
    close: async () => {
      await queues.close();
      await db.$disconnect();
    },
  });
  const server = createServer((req, res) => {
    void health.respond(req.method, req.url).then(({ status, body }) => {
      res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(body);
    });
  });
  server.listen(settings.port, "0.0.0.0");
  const stop = () => {
    telemetry?.stop();
    controller.abort();
    server.close();
    setTimeout(() => process.exit(1), 30_000).unref();
    void runtime.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
type Context = {
  settings: ReturnType<typeof parseWorkerConfig>;
  config: ReturnType<typeof parseAgentConfig> | undefined;
  db: ReturnType<typeof createDb>;
  controller: AbortController;
  queues: ReturnType<typeof createQueues>;
  health: ReturnType<typeof createWorkerHealth>;
};
function connectProcessing({ settings, config, db, controller, queues, health }: Context) {
  const clock = () => new Date();
  const delivery = (id: string) => createDeliveryStore(db, id, clock, settings.days);
  if (config)
    queues.worker(
      createAgentWorker({
        db,
        clock,
        config,
        retentionDays: settings.days,
        shutdownSignal: controller.signal,
        report: () => health.report("queue_failed"),
        model: createBedrockClient({ region: config.region, modelId: config.modelId }),
        classifier: createBedrockClient({ region: config.region, modelId: config.smallModelId }),
      }),
    );
  if (settings.outbound)
    queues.outboundWorker(
      createOutboundProcessor({
        store: delivery,
        limit: queues.limit,
        send: async (sender, message) =>
          createWhatsAppSender({ ...sender, token: process.env[sender.credentialEnv] ?? "" })(
            message,
          ),
      }),
    );
  return createSweep({
    signal: controller.signal,
    businesses: async () => (await db.business.findMany({ select: { id: true } })).map((b) => b.id),
    dispatch: async (id) => {
      const inbox = createInboxStore(db, id, clock, settings.days);
      if (settings.inbound) {
        await dispatchInbox(inbox, queues.inbound);
        await dispatchDead({ listDue: () => inbox.listDead() }, queues.dead);
      }
      if (settings.outbound) {
        await dispatchOutbound(delivery(id), queues.outbound);
        await dispatchDead({ listDue: () => delivery(id).listDead() }, queues.dead);
      }
    },
    retain: (id) => redactBusinessContent(db, id, { clock, days: settings.days }),
  });
}
Promise.resolve()
  .then(main)
  .catch(() => {
    console.error(JSON.stringify({ event: "worker_start_failed" }));
    process.exit(1);
  });

function workerTelemetry(db: ReturnType<typeof createDb>, ping: () => Promise<unknown>) {
  const telemetryConfig = parseTelemetryConfig(process.env);
  const telemetry =
    telemetryConfig &&
    createTelemetry({
      ...telemetryConfig,
      service: "worker",
      clock: Date.now,
      output: (record) => process.stdout.write(JSON.stringify(record) + "\n"),
      probe: async () => {
        await Promise.all([db.$queryRaw`SELECT 1`, ping()]);
      },
    });
  return telemetry;
}
