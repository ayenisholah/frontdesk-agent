import { createApp } from "./app.js";
import { createDependencies } from "./checks.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./log.js";

const config = loadConfig();
const log = createLogger(config.LOG_LEVEL, { service: "api", release: config.RELEASE_SHA.slice(0, 12) });
const deps = createDependencies(config.DATABASE_URL, config.REDIS_URL);
const app = createApp({ checks: deps.checks, log, release: config.RELEASE_SHA });

const server = app.listen(config.PORT, config.HOST, () => {
  log.info("listening", { port: config.PORT });
});
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;

let stopping = false;
const shutdown = (signal: string) => {
  if (stopping) return;
  stopping = true;
  log.info("shutting down", { signal });
  server.close(async () => {
    await deps.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
