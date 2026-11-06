import { z } from "zod";
import type { ConversationResult } from "./conversation";
import type { ModelClient, ModelResponse } from "./model-client";

const responseSchema = z.object({
  text: z.string().optional(),
  toolCalls: z.array(z.object({ id: z.string(), name: z.string(), input: z.unknown() })).optional(),
});
const scenarioSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  turns: z
    .array(
      z.object({
        message: z.string().min(1),
        category: z.string(),
        language: z.enum(["english", "other"]),
        responses: z.array(responseSchema),
        replyIncludes: z.string().optional(),
        handoff: z.string().optional(),
      }),
    )
    .min(1),
  expected: z.object({
    activeHolds: z.number().int().min(0),
    owner: z.boolean(),
    startsAt: z.string().optional(),
  }),
});
export type EvalScenario = z.infer<typeof scenarioSchema>;
export type EvaluationState = {
  activeHolds: number;
  owner: boolean;
  startsAt: string | null;
  confirmedBookings: number;
  runs: number;
  completeRuns: number;
  costMicros: number;
};
export type EvaluationResult = {
  id: string;
  passed: boolean;
  failures: string[];
  state: EvaluationState;
  expectedOwner: boolean;
  turnLatenciesMs: number[];
};
export function parseEvalScenario(value: unknown): EvalScenario {
  return scenarioSchema.parse(value);
}

/** Only used by the explicit deterministic harness, never selected by application config. */
export function createScriptedModel(script: z.infer<typeof responseSchema>[]): ModelClient {
  let index = 0;
  return {
    complete: () => {
      const next = script[index++];
      if (!next) return Promise.reject(new Error("Script exhausted"));
      const response: ModelResponse = {
        text: next.text ?? "",
        toolCalls: next.toolCalls ?? [],
        usage: { inputTokens: 10, outputTokens: 5 },
      };
      return Promise.resolve(response);
    },
  };
}

type Session = {
  turn: (turn: EvalScenario["turns"][number]) => Promise<ConversationResult>;
  inspect: () => Promise<EvaluationState>;
};
export async function evaluateScenario(
  scenario: EvalScenario,
  session: Session,
): Promise<EvaluationResult> {
  const failures: string[] = [];
  const turnLatenciesMs: number[] = [];
  for (const [index, turn] of scenario.turns.entries()) {
    const started = performance.now();
    const result = await session.turn(turn);
    turnLatenciesMs.push(Math.round(performance.now() - started));
    failures.push(...checkTurn(turn, result, index));
  }
  const state = await session.inspect();
  failures.push(...checkState(scenario, state));
  return {
    id: scenario.id,
    passed: failures.length === 0,
    failures,
    state,
    expectedOwner: scenario.expected.owner,
    turnLatenciesMs,
  };
}
export function summarizeEvals(results: EvaluationResult[]) {
  const latencies = results.flatMap((r) => r.turnLatenciesMs).sort((a, b) => a - b);
  const costMicros = results.reduce((sum, r) => sum + r.state.costMicros, 0);
  const held = results.filter((r) => r.state.activeHolds > 0).length;
  return {
    scenarios: results.length,
    passRate: results.length ? results.filter((r) => r.passed).length / results.length : 0,
    costMicros,
    costPerHeldConversationMicros: held ? Math.ceil(costMicros / held) : null,
    costPerBookedConversationMicros: null,
    p95TurnLatencyMs: latencies[Math.ceil(latencies.length * 0.95) - 1] ?? 0,
    correctHandoffs: results.filter((r) => r.state.owner && r.expectedOwner).length,
    unnecessaryHandoffs: results.filter((r) => r.state.owner && !r.expectedOwner).length,
  };
}

function checkTurn(turn: EvalScenario["turns"][number], result: ConversationResult, index: number) {
  const failures: string[] = [];
  if (result.state !== "replied") failures.push(`turn:${index}:state`);
  if (turn.replyIncludes && !result.reply?.includes(turn.replyIncludes))
    failures.push(`turn:${index}:reply`);
  if (turn.handoff !== undefined && result.handoff !== turn.handoff)
    failures.push(`turn:${index}:handoff`);
  return failures;
}
function checkState(scenario: EvalScenario, state: EvaluationState) {
  const failures: string[] = [];
  if (state.confirmedBookings !== 0) failures.push("confirmedBookings");
  if (state.activeHolds !== scenario.expected.activeHolds) failures.push("activeHolds");
  if (state.owner !== scenario.expected.owner) failures.push("owner");
  if (scenario.expected.startsAt && state.startsAt !== scenario.expected.startsAt)
    failures.push("startsAt");
  if (state.runs !== scenario.turns.length || state.completeRuns !== state.runs)
    failures.push("traces");
  return failures;
}
