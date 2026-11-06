import { harborPaws } from "@frontdesk/core";
import { describe, expect, it, vi } from "vitest";
import { runConversationTurn, type AgentStore, type AgentConfig } from "../src/index";
import { call, fakeModel } from "./fake-model";

const config: AgentConfig = {
  region: "eu-west-1",
  modelId: "eu.main",
  smallModelId: "eu.small",
  rates: {
    version: "test",
    models: {
      "eu.main": { inputMicrosPerToken: 3, outputMicrosPerToken: 15 },
      "eu.small": { inputMicrosPerToken: 1, outputMicrosPerToken: 5 },
    },
  },
};
function setup(category = "routine", language = "english") {
  const store: AgentStore = {
    claim: vi.fn(async () => ({
      state: "claimed" as const,
      runId: "run",
      snapshot: {
        config: harborPaws,
        messages: [{ role: "user" as const, text: "Hi" }],
        customerName: null,
        activeHold: null,
        booking: null,
      },
    })),
    availability: vi.fn(async () => []),
    hold: vi.fn(async () => ({ ok: false as const, reason: "slot_unavailable" })),
    handoff: vi.fn(async () => undefined),
    recordUsage: vi.fn(async () => undefined),
    recordStep: vi.fn(async () => undefined),
    taskFailure: vi.fn(async () => 0),
    finish: vi.fn(async () => undefined),
  };
  const classifier = fakeModel([{ text: JSON.stringify({ category, language }) }]);
  const model = fakeModel([
    { toolCalls: [call("get_services")] },
    { text: "Invented free service at 02:07" },
  ]);
  const options = {
    store,
    model: model.client,
    classifier: classifier.client,
    config,
    clock: () => new Date("2031-03-03T08:00:00Z"),
  };
  return { store, options, run: () => runConversationTurn(options, "message") };
}

describe("conversation orchestration", () => {
  it("renders trusted facts, records both models' usage and saves the reply", async () => {
    const { run, store } = setup();
    const result = await run();
    expect(result.reply).toContain(harborPaws.services[0]!.name);
    expect(result.reply).not.toContain("Invented");
    expect(store.recordUsage).toHaveBeenCalledTimes(3);
    expect(store.recordStep).toHaveBeenCalledTimes(2);
    expect(store.finish).toHaveBeenCalledWith(
      "run",
      expect.objectContaining({ outcome: "replied" }),
    );
  });
  it.each(["silent", "busy"] as const)("does not call models for %s turns", async (state) => {
    const { options, store, run } = setup();
    vi.mocked(store.claim).mockResolvedValue({ state });
    options.model = { complete: vi.fn() };
    expect((await run()).state).toBe(state);
    expect(options.model.complete).not.toHaveBeenCalled();
  });
  it("returns a stored reply on duplicate delivery", async () => {
    const { run, store } = setup();
    vi.mocked(store.claim).mockResolvedValue({ state: "replay", reply: "Already held" });
    expect((await run()).reply).toBe("Already held");
    expect(store.finish).not.toHaveBeenCalled();
  });
  it.each([
    "complaint",
    "refund",
    "health",
    "unsupported_price",
    "low_confidence",
    "customer_request",
  ])("forces a %s handoff", async (category) => {
    const { run, store } = setup(category);
    expect((await run()).handoff).toBe(category);
    expect(store.handoff).toHaveBeenCalledWith("run", "system-handoff", category);
  });
  it("offers handoff in English for another language", async () => {
    expect((await setup("routine", "other").run()).reply).toContain("English");
  });
  it("stops immediately after an explicit handoff within a batch", async () => {
    const { options, store, run } = setup();
    options.model = fakeModel([
      {
        toolCalls: [
          call("handoff_to_owner", { reason: "refund" }),
          call("hold_slot", {
            serviceKey: harborPaws.services[0]!.id,
            startsAt: "2031-03-03T10:00:00Z",
          }),
        ],
      },
    ]).client;
    expect((await run()).handoff).toBe("refund");
    expect(store.hold).not.toHaveBeenCalled();
  });
  it("hands off on the third failed task, across turns", async () => {
    const { options, store, run } = setup();
    vi.mocked(store.taskFailure).mockResolvedValue(3);
    options.model = fakeModel([{ toolCalls: [call("missing")] }]).client;
    expect((await run()).handoff).toBe("repeated_failure");
  });
  it("preserves steps and hands off after a subsequent model failure", async () => {
    const { options, store, run } = setup();
    options.model = fakeModel([{ toolCalls: [call("get_services")] }]).client;
    expect((await run()).handoff).toBe("model_error");
    expect(store.recordStep).toHaveBeenCalledTimes(2);
  });
  it("does not swallow trace storage failures", async () => {
    const { run, store } = setup();
    vi.mocked(store.recordUsage).mockRejectedValue(new Error("storage unavailable"));
    await expect(run()).rejects.toThrow("storage unavailable");
    expect(store.finish).not.toHaveBeenCalled();
  });
  it("rejects malformed classification and unsafe free-text replies", async () => {
    const { options, run } = setup();
    options.classifier = fakeModel([{ text: "nonsense" }]).client;
    expect((await run()).handoff).toBe("model_error");
    const second = setup();
    second.options.model = fakeModel([{ text: "A free booking is confirmed" }]).client;
    expect((await second.run()).handoff).toBe("unknown_question");
  });
  it("uses canned clarification wording", async () => {
    const { options, run } = setup();
    options.model = fakeModel([{ text: JSON.stringify({ clarification: "date" }) }]).client;
    expect((await run()).reply).toBe("Which date would you prefer?");
  });
});

it("handles failed and tool-producing classifiers without running business tools", async () => {
  for (const classifier of [
    fakeModel([]).client,
    fakeModel([{ text: "{}", toolCalls: [call("unexpected")] }]).client,
  ]) {
    const { options, run, store } = setup();
    options.classifier = classifier;
    expect((await run()).handoff).toBe("model_error");
    expect(store.hold).not.toHaveBeenCalled();
  }
});

it("applies one budget across the classifier and main model", async () => {
  const first = setup();
  first.options.classifier = fakeModel([
    { text: "{}", usage: { inputTokens: 40_000, outputTokens: 0 } },
  ]).client;
  expect((await first.run()).handoff).toBe("token_budget");
  const second = setup();
  second.options.model = fakeModel([
    { text: "{}", usage: { inputTokens: 39_990, outputTokens: 0 } },
  ]).client;
  expect((await second.run()).handoff).toBe("token_budget");
});

it("records a domain refusal as a failed task and uses its trusted wording", async () => {
  const { options, run, store } = setup();
  options.model = fakeModel([
    {
      toolCalls: [
        call("hold_slot", {
          serviceKey: harborPaws.services[0]!.id,
          startsAt: "2031-03-03T10:00:00Z",
        }),
      ],
    },
    { text: "ok" },
  ]).client;
  expect((await run()).reply).toContain("unavailable");
  expect(store.taskFailure).toHaveBeenCalledWith("run", "hold_slot", true);
});

it("hands off when a failed unknown tool has no trusted reply", async () => {
  const { options, run } = setup();
  options.model = fakeModel([{ toolCalls: [call("nope")] }, { text: "ok" }]).client;
  expect((await run()).handoff).toBe("unknown_question");
});

it("records unusable classifier usage without treating it as a successful classification", async () => {
  const { ModelFailure } = await import("../src/index");
  const { options, run, store } = setup();
  options.classifier = {
    complete: vi
      .fn()
      .mockRejectedValue(
        new ModelFailure("invalid_response", { inputTokens: 20, outputTokens: 10 }),
      ),
  };
  expect((await run()).handoff).toBe("model_error");
  expect(store.recordUsage).toHaveBeenCalledWith("run", {
    modelId: "eu.small",
    usage: { inputTokens: 20, outputTokens: 10 },
    costMicros: 70,
    ratesVersion: "test",
  });
});

it("propagates storage failures while recording rejected classifier usage", async () => {
  const { ModelFailure } = await import("../src/index");
  const { options, run, store } = setup();
  options.classifier = {
    complete: vi
      .fn()
      .mockRejectedValue(new ModelFailure("invalid_response", { inputTokens: 1, outputTokens: 1 })),
  };
  vi.mocked(store.recordUsage).mockRejectedValue(new Error("store down"));
  await expect(run()).rejects.toThrow("store down");
});
