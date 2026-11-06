import type { Usage } from "./model-client";

/** Provider details may contain request content. Only this bounded code crosses the adapter. */
export class ModelFailure extends Error {
  constructor(
    readonly code: "timeout" | "unavailable" | "invalid_response",
    readonly usage?: Usage,
  ) {
    super(`Model ${code}`);
    this.name = "ModelFailure";
  }
}

/** Rejected completions can still report billable usage. Storage failures must propagate. */
export async function recordFailureUsage(error: unknown, record: (usage: Usage) => Promise<void>) {
  if (error instanceof ModelFailure && error.usage) await record(error.usage);
}
