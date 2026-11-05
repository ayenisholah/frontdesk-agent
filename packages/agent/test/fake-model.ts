import type { ModelClient, ModelRequest, ModelResponse, ToolCall } from "../src/index";

type Script = Partial<Omit<ModelResponse, "toolCalls">> & { toolCalls?: ToolCall[] };

/** A model that plays back a script, and records what it was sent. */
export function fakeModel(script: Script[], fallback?: Script) {
  const requests: ModelRequest[] = [];
  const client: ModelClient = {
    complete: async (request) => {
      // Copied, because the loop keeps appending to the same array.
      requests.push({ ...request, messages: [...request.messages] });
      const next = script[requests.length - 1] ?? fallback;
      if (!next) throw new Error("The fake model ran out of script");
      return {
        text: next.text ?? "",
        toolCalls: next.toolCalls ?? [],
        usage: next.usage ?? { inputTokens: 10, outputTokens: 5 },
      };
    },
  };
  return { client, requests };
}

export const call = (name: string, input: unknown = {}, id = `call-${name}`): ToolCall => ({
  id,
  name,
  input,
});
