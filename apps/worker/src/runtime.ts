type Dependencies = {
  dispatch(): Promise<void>;
  retain(): Promise<void>;
  close(): Promise<void>;
  report(event: "dispatch_failed" | "retention_failed"): void;
};
/** A slow dependency never creates overlapping reconciliation or retention sweeps. */
export function createRuntime(deps: Dependencies) {
  const controller = new AbortController();
  const dispatch = loop(
    () => deps.dispatch(),
    1000,
    () => deps.report("dispatch_failed"),
  );
  const retention = loop(
    () => deps.retain(),
    86_400_000,
    () => deps.report("retention_failed"),
  );
  let stopping: Promise<void> | undefined;
  return {
    signal: controller.signal,
    stop() {
      if (!stopping) {
        controller.abort();
        stopping = Promise.all([dispatch.stop(), retention.stop()]).then(() => deps.close());
      }
      return stopping;
    },
  };
}
function loop(work: () => Promise<void>, interval: number, report: () => void) {
  let active: Promise<void> | undefined;
  function tick() {
    active ??= Promise.resolve()
      .then(work)
      .catch(report)
      .finally(() => {
        active = undefined;
      });
  }
  const timer = setInterval(tick, interval);
  tick();
  return {
    stop: () => {
      clearInterval(timer);
      return active;
    },
  };
}
