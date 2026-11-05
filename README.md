# Frontdesk

An AI front desk on WhatsApp for appointment-based small businesses. It answers customers, quotes services from the owner's price list, books real slots, takes a deposit, sends reminders, and hands the conversation to the owner when it shouldn't decide alone.

> **Status:** in development. The foundation is done: monorepo, quality gates, design system, data model and API health checks. See the [roadmap](docs/ROADMAP.md) for what comes next.

## Why it's built this way

- **Money and confirmations sit outside the model.** Prices come from config, slots from a deterministic availability engine, and a booking is confirmed only by Stripe's webhook.
- **Every agent decision is traced**: tools called, inputs, outputs, tokens, cost and latency.
- **Evals gate every change.** 40+ scripted conversations, including adversarial ones, run in CI. The pass rate, cost per booking and p95 latency are published below as they're measured.

## Docs

| Doc                                                    | What's in it                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| [PRD](docs/PRD.md)                                     | Problem, users, journeys, success metrics, pilot plan                |
| [Requirements](docs/REQUIREMENTS.md)                   | Numbered functional, non-functional, guardrail and eval requirements |
| [SPEC](SPEC.md)                                        | Scope, tools, data model, eval approach                              |
| [Roadmap](docs/ROADMAP.md)                             | Milestones and the requirements each one closes                      |
| [Architecture](docs/ARCHITECTURE.md)                   | System views, module boundaries, AWS target                          |
| [ADRs](docs/adr/README.md)                             | Decisions and why they were made                                     |
| [Engineering standards](docs/ENGINEERING_STANDARDS.md) | Modularity, reuse, errors, naming                                    |
| [Test strategy](docs/TEST_STRATEGY.md)                 | Test levels, coverage policy, evals                                  |
| [Design system](docs/DESIGN_SYSTEM.md)                 | Tokens, CSS layers, components, conversation design                  |
| [Threat model](docs/THREAT_MODEL.md)                   | Threats, controls and their status                                   |
| [Data privacy](docs/DATA_PRIVACY.md)                   | Data classification, retention, deletion                             |
| [Release process](docs/RELEASE_PROCESS.md)             | Environments, versioning, migrations, rollback                       |
| [Contributing](CONTRIBUTING.md)                        | Setup, branches, commits, pull requests                              |
| [Security](SECURITY.md)                                | Vulnerability reporting and current controls                         |

## Architecture

```
WhatsApp / Twilio ──► api (Express) ──► BullMQ inbound ──► agent worker ──► BullMQ outbound ──► channels
Stripe webhook ──► payments worker ──► confirm booking            │
Scheduler ──► reminders, hold expiry                    Postgres (state, traces) · Redis (queues)
Owner ──► dashboard (Next.js, design system in apps/dashboard/styles)
```

Workspace layout: `apps/{api,worker,dashboard}`, `packages/{core,agent,channels,db}`, `design/` (token source), `deploy/` (legacy server scripts, removed at AWS cutover).

## Quick start

Needs Node 24 and Docker.

```sh
cp .env.example .env
npm ci
docker compose up -d --build     # postgres, redis, api on http://127.0.0.1:3110
curl http://127.0.0.1:3110/readyz
npm test
```

| Script                                                | Does                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| `npm run check`                                       | Runs every local gate below, as CI does                                      |
| `npm run lint` / `typecheck` / `format:check`         | ESLint, strict TypeScript, Prettier                                          |
| `npm test` / `test:coverage`                          | Vitest, with the 100% coverage gate                                          |
| `npm run check:deps` / `check:dupes` / `check:unused` | Module boundaries, duplicated code, unused code                              |
| `npm run tokens`                                      | Generates `apps/dashboard/styles/tokens.css` from `design/tokens.ts`         |
| `npm run audit:tokens`                                | Fails if tokens.css is stale or a colour pair misses WCAG AA in either theme |
| `npm run audit:units`                                 | Fails on any `px` in styles or tokens (rem, em, % only)                      |

## Deployment

GitHub Actions runs every check on each pull request. Automatic deployment is paused while the project moves to AWS (ECS Fargate, RDS and ElastiCache, defined in CDK): see [ADR 0002](docs/adr/0002-aws-ecs-fargate.md) and milestone M4 in the [roadmap](docs/ROADMAP.md).

## Results

The eval and pilot numbers go here once they've been measured (milestones M8 and M9).

## License

MIT
