# Architecture

**Related:** [SPEC](../SPEC.md) · [ADRs](adr/README.md) · [Engineering standards](ENGINEERING_STANDARDS.md) · [Threat model](THREAT_MODEL.md)

This describes the target system. Milestones in the [roadmap](ROADMAP.md) deliver it in stages: today the API serves health checks; the booking engine and a CLI agent with replay-safe tools and persisted traces exist. WhatsApp workers and AWS hosting remain planned.

## System context

```
Customer ── WhatsApp / SMS ──► Meta, Twilio ──┐
Customer ── deposit ─────────► Stripe ────────┤ webhooks
                                              ▼
                                         ┌──────────┐ ── model calls ──► Amazon Bedrock
Owner ── browser, WhatsApp ────────────► │ Frontdesk│
                                         └──────────┘
```

## Containers

| Container | Runs as | Responsibility |
| --- | --- | --- |
| `apps/api` | ECS service | Verifies and dedupes webhooks, enqueues work, serves the dashboard API |
| `apps/worker` | ECS service | BullMQ workers: agent, outbound, payments, scheduler |
| `apps/dashboard` | ECS service | Next.js owner UI |
| Postgres | RDS | Businesses, conversations, bookings, payments, traces |
| Redis | ElastiCache | BullMQ queues and delayed jobs |

## Message flow

1. A webhook reaches `api`, which verifies the signature and dedupes by provider message id.
2. The message is stored and queued on `inbound`, keeping one-at-a-time order per conversation.
3. The agent worker loads state and config, runs the model loop with tools, and persists a trace.
4. Side-effecting tools pass policy checks first. Replies go to the `outbound` queue.
5. The outbound worker applies rate limits and the WhatsApp 24-hour window, then sends through a channel adapter.

Stripe's webhook follows the same pattern: only the payments worker can move a booking to `confirmed`.

## Module boundaries

```
apps/api ─────┐
apps/worker ──┼──► packages/agent ──► packages/core
apps/dashboard┘    packages/channels
                   packages/db ─────► packages/core
```

- `packages/core` is pure domain logic: no I/O, and its only runtime dependency is Zod.
- Packages never import apps, and apps never import each other.
- Workspaces import each other through their entry point only.

`npm run check:deps` enforces these rules. See `.dependency-cruiser.cjs`.

## AWS target

```
Internet ─► ALB ─► ECS Fargate: api, dashboard
                   ECS Fargate: worker ─► Bedrock
                         │
          private subnets: RDS Postgres · ElastiCache Redis
          Secrets Manager · ECR · CloudWatch
```

Decisions are in [ADR 0002](adr/0002-aws-ecs-fargate.md), [0003](adr/0003-cdk-infrastructure.md), [0004](adr/0004-bedrock-model-provider.md) and [0008](adr/0008-github-actions-oidc-deploy.md). Milestone M4 builds this. Production currently runs on a legacy server that no longer receives deploys.

## Failure behaviour

| Failure | Behaviour |
| --- | --- |
| Model error or timeout | Retry with backoff; after 3 failures, send a canned reply and hand off (NFR-9) |
| Channel send fails | Retry; a permanent failure goes to the dead-letter queue and alerts the owner (FR-CH-2) |
| Duplicate webhook | No second effect (NFR-2) |
| Postgres or Redis down | `/readyz` returns 503 and the service is taken out of rotation; `/healthz` stays 200 |

## Current agent execution

The CLI injects the database's `AgentStore` into `runConversationTurn`. A short
business-scoped transaction claims the inbound message; no transaction is held
across model calls. The small model classifies the request, then the main model
selects policy-checked tools. Model prose never supplies customer-facing facts:
replies render tool results or fixed clarification text. Every reported model
usage and completed tool step is persisted before proceeding. See
[ADR 0012](adr/0012-agent-execution.md) and [local commands](AGENT_DEVELOPMENT.md).
