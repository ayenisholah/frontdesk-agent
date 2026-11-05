import type { Logger } from "./log.js";

export interface ShutdownOptions {
  /** Stops accepting connections and calls back once in-flight requests finish. */
  stopServer: (done: () => void) => void;
  closeDependencies: () => Promise<void>;
  log: Logger;
  exit: (code: number) => void;
  timeoutMs?: number;
}

/** Builds an idempotent signal handler: drain, close dependencies, exit; force-exit after the timeout. */
export function createShutdown({
  stopServer,
  closeDependencies,
  log,
  exit,
  timeoutMs = 10_000,
}: ShutdownOptions) {
  let stopping = false;
  return (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info("shutting down", { signal });
    stopServer(() => {
      void closeDependencies().then(() => exit(0));
    });
    setTimeout(() => exit(1), timeoutMs).unref();
  };
}
