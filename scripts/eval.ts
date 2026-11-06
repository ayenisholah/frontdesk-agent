import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { parse } from "yaml";
import {
  createBedrockClient,
  createScriptedModel,
  evaluateScenario,
  parseAgentConfig,
  parseEvalScenario,
  runConversationTurn,
  summarizeEvals,
  type AgentConfig,
  type EvalScenario,
  type EvaluationResult,
} from "@frontdesk/agent";
import {
  appendSandboxMessage,
  createAgentStore,
  createDb,
  inspectSandbox,
  openSandbox,
  type Db,
} from "@frontdesk/db";

// Synthetic rates only measure deterministic harness accounting, never AWS spend.
const fixtureConfig: AgentConfig = {
  region: "eu-west-1",
  modelId: "eu.fixture",
  smallModelId: "eu.fixture-small",
  rates: {
    version: "synthetic-not-billing",
    models: {
      "eu.fixture": { inputMicrosPerToken: 1, outputMicrosPerToken: 1 },
      "eu.fixture-small": { inputMicrosPerToken: 1, outputMicrosPerToken: 1 },
    },
  },
};
async function runScenario(db: Db, scenario: EvalScenario, config: AgentConfig, live: boolean) {
  let time = Date.parse("2031-03-03T12:00:00Z");
  const clock = () => new Date(time++);
  const scope = await openSandbox(db, {
    fixture: "harbor-paws",
    name: `eval-${scenario.id}-${randomUUID()}`,
  });
  const store = createAgentStore(db, scope, clock);
  return evaluateScenario(scenario, {
    async turn(turn) {
      const model = live
        ? createBedrockClient({ region: config.region, modelId: config.modelId })
        : createScriptedModel(turn.responses);
      const classifier = live
        ? createBedrockClient({ region: config.region, modelId: config.smallModelId })
        : createScriptedModel([
            { text: JSON.stringify({ category: turn.category, language: turn.language }) },
          ]);
      const messageId = await appendSandboxMessage(db, scope, turn.message, clock);
      return runConversationTurn({ store, model, classifier, config, clock }, messageId);
    },
    inspect: () => inspectSandbox(db, scope, clock),
  });
}
async function main() {
  const { values } = parseArgs({
    options: {
      live: { type: "boolean", default: false },
      scenario: { type: "string" },
      "plant-invalid-expectation": { type: "boolean", default: false },
    },
  });
  const config = values.live ? parseAgentConfig(process.env) : fixtureConfig;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const db = createDb(process.env.DATABASE_URL);
  const results: EvaluationResult[] = [];
  try {
    const files = (await readdir("evals")).filter((f) => f.endsWith(".yaml")).sort();
    for (const file of files) {
      const scenario = parseEvalScenario(parse(await readFile(`evals/${file}`, "utf8")) as unknown);
      if (values.scenario && scenario.id !== values.scenario) continue;
      if (values["plant-invalid-expectation"] && results.length === 0)
        scenario.expected.activeHolds = 99;
      results.push(await runScenario(db, scenario, config, values.live));
    }
    if (!results.length) throw new Error("No scenarios selected");
    const report = {
      mode: values.live ? "live-bedrock" : "deterministic-not-model-quality",
      models: [config.modelId, config.smallModelId],
      ratesVersion: config.rates.version,
      ...summarizeEvals(results),
      results,
    };
    await mkdir("artifacts", { recursive: true });
    await writeFile("artifacts/eval-report.json", JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    if (results.some((r) => !r.passed)) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error("Evaluation failed before completion. Check database and model configuration.");
  process.exitCode = 1;
});
