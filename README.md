# Frontdesk

An AI front desk on WhatsApp for appointment-based small businesses. It answers customers, quotes services from the owner's price list, books real slots, takes a deposit, sends reminders, and hands the conversation to the owner when it shouldn't decide alone.

> **Status:** Day 1 of a 14-day build ([build plan](docs/BUILD_PLAN.md)). Today: monorepo, CI, design system and a secure production deploy of the API with Postgres and Redis. The agent arrives on Days 5–6, WhatsApp on Day 7, deposits on Day 9.

## Why it's built this way

- **Money and confirmations sit outside the model.** Prices come from config, slots from a deterministic availability engine, and a booking is confirmed only by Stripe's webhook.
- **Every agent decision is traced**: tools called, inputs, outputs, tokens, cost and latency.
- **Evals gate every change.** 40+ scripted conversations, including adversarial ones, run in CI. The pass rate, cost per booking and p95 latency are published below as they're measured.

## Docs

| Doc | What's in it |
|---|---|
| [SPEC](SPEC.md) | Architecture, tools, data model, eval approach |
| [PRD](docs/PRD.md) | Problem, users, journeys, success metrics, pilot plan |
| [Requirements](docs/REQUIREMENTS.md) | Numbered functional, non-functional, guardrail and eval requirements with acceptance checks |
| [Design system](docs/DESIGN_SYSTEM.md) | Tokens, CSS layers, components, and the agent's conversation design |
| [Build plan](docs/BUILD_PLAN.md) | 14 one-hour sessions, each closing named requirements |
| [Security](SECURITY.md) | How the deploy and runtime are locked down |

## Architecture

```
WhatsApp / Twilio ──► api (Express) ──► BullMQ inbound ──► agent worker ──► BullMQ outbound ──► channels
Stripe webhook ──► payments worker ──► confirm booking            │
Scheduler ──► reminders, hold expiry                    Postgres (state, traces) · Redis (queues)
Owner ──► dashboard (Next.js, design system in apps/dashboard/styles)
```

Workspace layout: `apps/{api,worker,dashboard}`, `packages/{core,agent,channels,db}`, `design/` (token source), `deploy/` (production compose and server scripts).

## Quick start

Needs Node 24 and Docker.

```sh
cp .env.example .env
npm ci
docker compose up -d --build     # postgres, redis, api on http://127.0.0.1:3110
curl http://127.0.0.1:3110/readyz
npm test
```

| Script | Does |
|---|---|
| `npm run lint` / `typecheck` / `test` | ESLint, strict TypeScript, Vitest |
| `npm run tokens` | Generates `apps/dashboard/styles/tokens.css` from `design/tokens.ts` |
| `npm run audit:tokens` | Fails if tokens.css is stale or a colour pair misses WCAG AA in either theme |
| `npm run audit:units` | Fails on any `px` in styles or tokens (rem, em, % only) |

## Deployment

Every push to `main` runs verify → image → deploy on GitHub-hosted runners. The image built from that exact commit is streamed over SSH to a forced-command script on the server. The script checks the revision label, starts the release and waits for `/readyz`, and rolls back automatically if the release isn't ready. Details are in [SECURITY.md](SECURITY.md) and [`deploy/server/`](deploy/server/).

## Results

The eval and pilot numbers go here once they've been measured (Days 13–14).

## License

MIT
