import { z } from "zod";
export function parseTelemetryConfig(env: Record<string, string | undefined>) {
  if (env.TELEMETRY_ENABLED === undefined || env.TELEMETRY_ENABLED === "false") return;
  if (env.TELEMETRY_ENABLED !== "true" || env.TELEMETRY_STAGE !== "pilot")
    throw new Error("Invalid telemetry configuration");
  return { stage: z.literal("pilot").parse(env.TELEMETRY_STAGE) };
}
type Failure = "dispatch_failed" | "queue_failed" | "retention_failed";
type Options = {
  service: "api" | "worker";
  stage: "pilot";
  clock(): number;
  probe(): Promise<unknown>;
  output(record: Record<string, unknown>): void;
};
export function createTelemetry(options: Options) {
  let stopped = false;
  let pending: Promise<boolean> | undefined;
  const counters = { dispatch_failed: 0, queue_failed: 0, retention_failed: 0 };
  async function sample() {
    let ready = false;
    if (!pending) {
      pending = Promise.resolve()
        .then(() => options.probe())
        .then(
          () => true,
          () => false,
        );
      const current = pending;
      void current.then(() => {
        pending = undefined;
      });
      ready = await bounded(current);
    }
    if (stopped) return;
    const values = { Heartbeat: 1, Ready: Number(ready), ...counters };
    try {
      options.output(envelope(options, values));
      for (const key of Object.keys(counters) as Failure[]) counters[key] = 0;
    } catch {
      /* Monitoring must never interrupt application work. */
    }
  }
  const timer = setInterval(() => {
    void sample();
  }, 60_000);
  timer.unref();
  void sample();
  return {
    report(event: Failure) {
      counters[event] = Math.min(Number.MAX_SAFE_INTEGER, counters[event] + 1);
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
async function bounded(probe: Promise<boolean>) {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      probe,
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
function envelope(options: Options, values: Record<string, number>) {
  return {
    _aws: {
      Timestamp: options.clock(),
      CloudWatchMetrics: [
        {
          Namespace: "Frontdesk/Runtime",
          Dimensions: [["Stage", "Service"]],
          Metrics: Object.keys(values).map((Name) => ({ Name, Unit: "Count" })),
        },
      ],
    },
    Stage: options.stage,
    Service: options.service,
    ...values,
  };
}
