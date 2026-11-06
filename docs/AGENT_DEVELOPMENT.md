# Agent development

M2 provides a fictional-data CLI, five business tools, conversation orchestration,
trace persistence and 16 initial scenarios. Live-model acceptance is still pending
AWS authorization; the deterministic suite does not establish model quality.

## Local database

Use Node 24. Start Postgres, export the local `DATABASE_URL` from `.env.example`,
then run:

```sh
npm ci
npm run db:generate
npm run db:deploy
npm run eval
```

Each evaluation creates isolated fictional businesses with `sandbox-eval-` slugs.
Their messages and traces remain in the local database for inspection. The report
is `artifacts/eval-report.json` (ignored by Git). It includes pass rate, turn p95,
handoff correctness and estimated cost per held conversation. Cost per booked
conversation is unavailable until deposits exist. Deterministic mode uses
synthetic usage/rates and labels the report accordingly.

```sh
npm run eval -- --scenario multi-turn-hold
npm run eval -- --scenario services --plant-invalid-expectation # must exit 1
```

## Bedrock configuration

Authenticate the local SDK using the AWS default credential chain. MCP connector
credentials are separate and do not prove that the local application can invoke
a model. Set `AWS_REGION=eu-west-1`, `BEDROCK_MODEL_ID` and
`BEDROCK_MODEL_ID_SMALL` to authorized `eu.` inference profile IDs. Global
profiles and non-EU source regions are refused.

`BEDROCK_RATES` is a JSON object with a non-empty `version` and a `models` object
keyed by each exact profile ID. Each entry contains positive numeric
`inputMicrosPerToken` and `outputMicrosPerToken`. Obtain current standard inference
rates for the selected models from [AWS Bedrock pricing](https://aws.amazon.com/bedrock/pricing/).
A price of USD 1 per million tokens equals 1 microdollar per token. Both models
must have entries; missing or invalid rates fail startup without printing values.
Rates are estimates, versioned in each run and usage row; they are not a billing
reconciliation. Prompt caching and nonstandard service tiers are not enabled.

The adapter owns retries: three total SDK attempts within the 30-second request
abort deadline, with no whole-turn replay. A model timeout/failure hands off;
storage failures propagate. Do not put credentials in this repository.

```sh
npm run chat -- --fixture harbor-paws
npm run chat -- --conversation UUID_FROM_PREVIOUS_CHAT
npm run eval -- --live --scenario services
npm run eval -- --live
```

The CLI reads `.env` if it exists and prints an interactive fictional transcript;
it does not send WhatsApp messages. Type `:quit` to exit. Only CLI sandbox
conversations can be resumed. Input is limited to 5,000 characters.

## Traces and interrupted turns

`AgentRun` records the trigger message, prompt/rate versions, total tokens,
estimated cost, reply and outcome. `AgentUsage` records each model's reported
usage; `AgentStep` records classification and tool results. An unreported provider
failure cannot provide token counts and is recorded as an error outcome.
`ToolExecution` commits a mutating tool's result with its side effect, preventing
a repeated call from extending a hold. Task failure counters persist across turns.

An unfinished run blocks later turns in that conversation. This is deliberate:
do not blindly delete a run or replay it after a storage/process failure, because
a hold or handoff may already have committed. Inspect the trace and execution
records and route the thread to the owner. Automatic crash recovery and queued
message ordering belong to the M3 worker integration.

Only configuration-derived facts and fixed clarification text are delivered.
Semantic classification is model-dependent and must be evaluated live; the code
forces the handoff once a category is identified. Owner notification delivery is
still M6. No M2 tool can confirm a booking. No real customer data is permitted
before the retention controls are implemented.
