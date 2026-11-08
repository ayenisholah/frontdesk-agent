type Event = "dispatch_failed" | "retention_failed" | "queue_failed";
export function createWorkerHealth(
  probe: () => Promise<unknown>,
  signal: AbortSignal,
  report: (event: Event) => void,
) {
  const counters: Record<Event, number> = {
    dispatch_failed: 0,
    retention_failed: 0,
    queue_failed: 0,
  };
  return {
    report(event: Event) {
      report(event);
      counters[event] = Math.min(Number.MAX_SAFE_INTEGER, counters[event] + 1);
    },
    async respond(method: string | undefined, url: string | undefined) {
      if (method !== "GET") return { status: 405, body: "method not allowed\n" };
      if (url === "/healthz") return { status: 200, body: "ok\n" };
      if (url === "/metrics")
        return {
          status: 200,
          body: Object.entries(counters)
            .map(([key, value]) => `worker_${key}_total ${value}\n`)
            .join(""),
        };
      if (url !== "/readyz") return { status: 404, body: "not found\n" };
      const ready = !signal.aborted && (await isReady(probe));
      return { status: ready ? 200 : 503, body: ready ? "ready\n" : "unavailable\n" };
    },
  };
}
async function isReady(probe: () => Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(probe)
        .then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 2000);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer!);
  }
}
