/** Provider details may contain request content. Only this bounded code crosses the adapter. */
export class ModelFailure extends Error {
  constructor(readonly code: "timeout" | "unavailable" | "invalid_response") {
    super(`Model ${code}`);
    this.name = "ModelFailure";
  }
}
