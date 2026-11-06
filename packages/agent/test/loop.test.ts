import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineTool, runTurn, type Tool, type Turn } from "../src/index";
import { call, fakeModel } from "./fake-model";

type Context = { businessId: string };

const echo = defineTool<Context, z.ZodObject<{ text: z.ZodString }>>({
  name: "echo",
  description: "Repeats text.",
  schema: z.strictObject({ text: z.string() }),
  run: async ({ text }, context) => ({ text, businessId: context.businessId }),
});

const noop = defineTool<Context, z.ZodObject>({
  name: "noop",
  description: "Does nothing.",
  schema: z.strictObject({}),
  run: async () => ({ done: true }),
});

const broken = defineTool<Context, z.ZodObject>({
  name: "broken",
  description: "Always throws.",
  schema: z.strictObject({}),
  run: async () => {
    throw new Error("connection string with a password");
  },
});

const HANDOFF = "I'll pass this to the owner.";

function turn(
  model: Turn<Context>["model"],
  tools: Tool<Context>[] = [echo, noop, broken],
): Turn<Context> {
  return {
    model,
    system: "You are a front desk.",
    messages: [{ role: "user", text: "Hello" }],
    tools,
    context: { businessId: "biz-1" },
    handoffReply: HANDOFF,
  };
}

describe("runTurn", () => {
  it("returns the model's reply when it calls no tools", async () => {
    const { client } = fakeModel([{ text: "  Hi there  " }]);
    expect(await runTurn(turn(client))).toEqual({
      reply: "Hi there",
      steps: [],
      usage: { inputTokens: 10, outputTokens: 5 },
    });
  });

  it("sends the system prompt, tool specs and a bounded output limit", async () => {
    const { client, requests } = fakeModel([{ text: "Hi" }]);
    await runTurn(turn(client));
    expect(requests[0]?.system).toBe("You are a front desk.");
    expect(requests[0]?.maxTokens).toBeGreaterThan(0);
    expect(requests[0]?.tools.map((t) => t.name)).toEqual(["echo", "noop", "broken"]);
    expect(requests[0]?.tools[0]?.inputSchema).toMatchObject({
      type: "object",
      required: ["text"],
      additionalProperties: false,
    });
  });

  it("runs a tool, gives the model the result, then replies", async () => {
    const { client, requests } = fakeModel([
      { text: "Checking", toolCalls: [call("echo", { text: "x" })] },
      { text: "Done" },
    ]);
    const result = await runTurn(turn(client));
    expect(result.reply).toBe("Done");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(requests[1]?.messages.slice(1)).toEqual([
      { role: "assistant", text: "Checking", toolCalls: [call("echo", { text: "x" })] },
      {
        role: "tool",
        results: [
          { toolCallId: "call-echo", content: { text: "x", businessId: "biz-1" }, isError: false },
        ],
      },
    ]);
  });

  it("handles several tool calls in one response, in order", async () => {
    const { client } = fakeModel([
      { toolCalls: [call("noop", {}, "a"), call("echo", { text: "y" }, "b")] },
      { text: "Done" },
    ]);
    const { steps } = await runTurn(turn(client));
    expect(steps.map((s) => s.call.id)).toEqual(["a", "b"]);
  });

  it("adds up usage across model calls", async () => {
    const usage = { inputTokens: 100, outputTokens: 20 };
    const { client } = fakeModel([
      { toolCalls: [call("noop")], usage },
      { text: "Done", usage },
    ]);
    expect((await runTurn(turn(client))).usage).toEqual({ inputTokens: 200, outputTokens: 40 });
  });

  it("doesn't change the caller's messages", async () => {
    const { client } = fakeModel([{ toolCalls: [call("noop")] }, { text: "Done" }]);
    const input = turn(client);
    await runTurn(input);
    expect(input.messages).toHaveLength(1);
  });
});

describe("limits (GR-5, NFR-4)", () => {
  it("stops a model that keeps calling tools, after 6 steps", async () => {
    const { client, requests } = fakeModel([], { toolCalls: [call("noop")] });
    const result = await runTurn(turn(client));
    expect(result.handoff).toBe("step_cap");
    expect(result.reply).toBe(HANDOFF);
    expect(result.steps).toHaveLength(6);
    expect(requests).toHaveLength(6);
  });

  it("hands off immediately after exactly 6 steps", async () => {
    const six = Array.from({ length: 6 }, () => ({ toolCalls: [call("noop")] }));
    const { client } = fakeModel([...six, { text: "Done" }]);
    const result = await runTurn(turn(client));
    expect(result.handoff).toBe("step_cap");
  });

  it("can't get past the cap by batching calls into one response", async () => {
    const run = vi.fn(async () => ({}));
    const counted = defineTool<Context, z.ZodObject>({
      name: "counted",
      description: "Counts.",
      schema: z.strictObject({}),
      run,
    });
    const batch = Array.from({ length: 7 }, (_, i) => call("counted", {}, `c${i}`));
    const { client } = fakeModel([{ toolCalls: batch }]);
    const result = await runTurn(turn(client, [counted]));
    expect(result.handoff).toBe("step_cap");
    expect(run).not.toHaveBeenCalled();
  });

  it("stops when the token budget is spent, before running more tools", async () => {
    const { client } = fakeModel([
      { toolCalls: [call("noop")], usage: { inputTokens: 90, outputTokens: 20 } },
    ]);
    const result = await runTurn({ ...turn(client), tokenBudget: 100 });
    expect(result.handoff).toBe("token_budget");
    expect(result.steps).toHaveLength(0);
    expect(result.usage).toEqual({ inputTokens: 90, outputTokens: 20 });
  });

  it("has a default token budget", async () => {
    const usage = { inputTokens: 10_000_000, outputTokens: 0 };
    const { client } = fakeModel([{ text: "Hi", usage }]);
    expect((await runTurn(turn(client))).handoff).toBe("token_budget");
  });

  it("hands off rather than send an empty reply", async () => {
    const { client } = fakeModel([{ text: "   " }]);
    const result = await runTurn(turn(client));
    expect(result.handoff).toBe("empty_reply");
    expect(result.reply).toBe(HANDOFF);
  });
});

describe("tool failures reach the model as data", () => {
  const firstResult = async (toolCall: ReturnType<typeof call>) => {
    const { client } = fakeModel([{ toolCalls: [toolCall] }, { text: "Sorry" }]);
    return (await runTurn(turn(client))).steps[0]?.result;
  };

  it("reports an unknown tool", async () => {
    expect(await firstResult(call("nope"))).toMatchObject({
      isError: true,
      content: { error: "Unknown tool: nope" },
    });
  });

  it("reports invalid input", async () => {
    const result = await firstResult(call("echo", { text: 5 }));
    expect(result?.isError).toBe(true);
    expect(JSON.stringify(result?.content)).toContain("Invalid input");
  });

  it("refuses unknown fields, such as a smuggled business id", async () => {
    const result = await firstResult(call("echo", { text: "x", businessId: "other" }));
    expect(result?.isError).toBe(true);
  });

  it("takes the business from the context, never the input", async () => {
    const result = await firstResult(call("echo", { text: "x" }));
    expect(result?.content).toMatchObject({ businessId: "biz-1" });
  });

  it("hides what went wrong inside a tool", async () => {
    const result = await firstResult(call("broken"));
    expect(result?.isError).toBe(true);
    expect(JSON.stringify(result?.content)).not.toContain("password");
  });
});

it("records reported usage even when a model response is unusable", async () => {
  const { ModelFailure } = await import("../src/index");
  const usage = { inputTokens: 20, outputTokens: 10 };
  const onUsage = vi.fn(async () => undefined);
  const model = {
    complete: vi.fn().mockRejectedValue(new ModelFailure("invalid_response", usage)),
  };
  const result = await runTurn({ ...turn(model), onUsage });
  expect(result.handoff).toBe("model_error");
  expect(result.usage).toEqual(usage);
  expect(onUsage).toHaveBeenCalledWith(usage);
});

it("accounts for unusable responses without requiring trace hooks", async () => {
  const { ModelFailure } = await import("../src/index");
  for (const usage of [undefined, { inputTokens: 1, outputTokens: 2 }]) {
    const model = { complete: vi.fn().mockRejectedValue(new ModelFailure("timeout", usage)) };
    expect((await runTurn(turn(model))).handoff).toBe("model_error");
  }
});
