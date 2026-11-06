import { describe, expect, it } from "vitest";
import {
  createScriptedModel,
  evaluateScenario,
  parseEvalScenario,
  summarizeEvals,
  type EvaluationState,
} from "../src/index";

const scenario = () =>
  parseEvalScenario({
    id: "services",
    turns: [
      {
        message: "Prices?",
        category: "routine",
        language: "english",
        responses: [
          { toolCalls: [{ id: "s", name: "get_services", input: {} }] },
          { text: "done" },
        ],
        replyIncludes: "$40",
      },
    ],
    expected: { activeHolds: 0, owner: false },
  });
const state: EvaluationState = {
  activeHolds: 0,
  confirmedBookings: 0,
  owner: false,
  startsAt: null,
  runs: 1,
  completeRuns: 1,
  costMicros: 10,
};
describe("evaluation harness", () => {
  it("validates scenario files", () => {
    expect(scenario().id).toBe("services");
    expect(() => parseEvalScenario({ id: "bad" })).toThrow();
  });
  it("plays model responses without network and fails if exhausted", async () => {
    const model = createScriptedModel([
      { text: "ok" },
      { toolCalls: [{ id: "x", name: "get_services", input: {} }] },
    ]);
    const request = { system: "", messages: [], tools: [], maxTokens: 10 };
    expect((await model.complete(request)).text).toBe("ok");
    expect((await model.complete(request)).toolCalls).toHaveLength(1);
    await expect(model.complete(request)).rejects.toThrow("Script exhausted");
  });
  it("passes only when both reply and database assertions pass", async () => {
    const result = await evaluateScenario(scenario(), {
      turn: async () => ({ state: "replied", reply: "$40" }),
      inspect: async () => state,
    });
    expect(result.passed).toBe(true);
    expect(summarizeEvals([result]).passRate).toBe(1);
    expect(summarizeEvals([]).passRate).toBe(0);
  });
  it("fails a planted database violation even with a convincing reply", async () => {
    const result = await evaluateScenario(scenario(), {
      turn: async () => ({ state: "replied", reply: "$40" }),
      inspect: async () => ({ ...state, confirmedBookings: 1 }),
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("confirmedBookings");
  });
  it("reports every mismatch without relying on a model grader", async () => {
    const input = scenario();
    input.turns[0]!.handoff = "refund";
    input.expected.startsAt = "2031-03-03T15:00:00Z";
    const result = await evaluateScenario(input, {
      turn: async () => ({ state: "busy" }),
      inspect: async () => ({ ...state, activeHolds: 1, owner: true, runs: 0, completeRuns: 0 }),
    });
    expect(result.failures).toEqual(
      expect.arrayContaining([
        "turn:0:state",
        "turn:0:reply",
        "turn:0:handoff",
        "activeHolds",
        "owner",
        "startsAt",
        "traces",
      ]),
    );
  });
  it("checks explicit handoff and slot outcomes", async () => {
    const input = scenario();
    input.turns[0]!.replyIncludes = undefined;
    input.turns[0]!.handoff = "refund";
    input.expected.startsAt = "2031-03-03T15:00:00Z";
    expect(
      (
        await evaluateScenario(input, {
          turn: async () => ({ state: "replied", handoff: "refund" }),
          inspect: async () => ({ ...state, startsAt: input.expected.startsAt! }),
        })
      ).passed,
    ).toBe(true);
  });
});

it("summarizes latency, held-conversation cost and handoff correctness", async () => {
  const passed = await evaluateScenario(scenario(), {
    turn: async () => ({ state: "replied", reply: "$40" }),
    inspect: async () => state,
  });
  const unexpected = {
    ...passed,
    passed: false,
    state: { ...state, owner: true, activeHolds: 1 },
    turnLatenciesMs: [20, 10],
  };
  const expected = { ...unexpected, expectedOwner: true };
  expect(summarizeEvals([{ ...passed, turnLatenciesMs: [5] }, unexpected, expected])).toMatchObject(
    {
      passRate: 1 / 3,
      costPerHeldConversationMicros: 15,
      correctHandoffs: 1,
      unnecessaryHandoffs: 1,
      p95TurnLatencyMs: 20,
    },
  );
});
