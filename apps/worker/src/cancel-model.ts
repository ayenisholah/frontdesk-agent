import { ModelFailure, type ModelClient } from "@frontdesk/agent";

/** The deadline also bounds injected providers that ignore their AbortSignal. */
export function cancelModel(model: ModelClient, signal: AbortSignal): ModelClient {
  return {
    async complete(request) {
      if (signal.aborted) throw new ModelFailure("timeout");
      let abort!: () => void;
      const cancelled = new Promise<never>((_resolve, reject) => {
        abort = () => reject(new ModelFailure("timeout"));
        signal.addEventListener("abort", abort, { once: true });
      });
      try {
        return await Promise.race([model.complete({ ...request, signal }), cancelled]);
      } finally {
        signal.removeEventListener("abort", abort);
      }
    },
  };
}
