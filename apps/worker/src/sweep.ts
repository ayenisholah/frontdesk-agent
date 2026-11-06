export function createSweep(deps: {
  businesses(): Promise<string[]>;
  dispatch(businessId: string): Promise<void>;
  retain(businessId: string): Promise<{ messages: number; runs: number }>;
  signal: AbortSignal;
}) {
  return {
    async dispatch() {
      for (const id of await deps.businesses()) {
        if (deps.signal.aborted) break;
        await deps.dispatch(id);
      }
    },
    async retain() {
      for (const id of await deps.businesses()) {
        while (!deps.signal.aborted) {
          const result = await deps.retain(id);
          if (result.messages < 100 && result.runs < 100) break;
        }
      }
    },
  };
}
