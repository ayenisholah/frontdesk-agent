# 0011: Bedrock region and the agent's boundaries

**Status:** Accepted

## Context

The agent sends customer messages to a model, so where that happens is a data decision, not just an infrastructure one. The roadmap left the region to the AWS milestone, but the agent needs it first.

## Decision

- **EU only.** Model calls use `eu.` inference profiles, so customer text stays in the EU. `global.` profiles aren't used, because they could route anywhere.
- **Models come from configuration.** `BEDROCK_MODEL_ID` is the main agent model, and `BEDROCK_MODEL_ID_SMALL` handles cheap tasks. The current choices are Claude Sonnet and Haiku.
- **`packages/agent` doesn't import the database.** It depends on `core`, and defines a store interface that `packages/db` implements. Tools can then be tested without Postgres.
- **Limits live in code.** The step cap and token budget are in the loop, where nothing the model or a customer says can raise them.

## Consequences

- The application's AWS region should be in the EU too, which ADR 0002 left open.
- Bedrock invocation logging must stay off, or be locked down, because it would store customer text.
- Evals need AWS credentials, so they run locally until CI gets its OIDC role.
