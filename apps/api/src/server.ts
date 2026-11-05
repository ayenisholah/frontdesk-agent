import { createApp } from "./app.js";
import { createDependencies } from "./checks.js";
import { loadConfig } from "./config.js";
import { createShutdown } from "./lifecycle.js";
import { createLogger } from "./log.js";

const config = loadConfig();
const log = createLogger(config.LOG_LEVEL, {
  service: "api",
  release: config.RELEASE_SHA.slice(0, 12),
});
const deps = createDependencies(config.DATABASE_URL, config.REDIS_URL);
const app = createApp({ checks: deps.checks, log, release: config.RELEASE_SHA });

const server = app.listen(config.PORT, config.HOST, () => {
  log.info("listening", { port: config.PORT });
});
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;

const shutdown = createShutdown({
  stopServer: (done) => server.close(done),
  closeDependencies: deps.close,
  log,
  exit: (code) => process.exit(code),
});
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
