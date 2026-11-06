# Roadmap

**Related:** [PRD](PRD.md) · [Requirements](REQUIREMENTS.md) · [Architecture](ARCHITECTURE.md) · [SPEC](../SPEC.md)

Work is organised into milestones. Each one closes named requirement IDs and ends with a "done when" check. Each feature inside a milestone gets its own branch and pull request (see [CONTRIBUTING](../CONTRIBUTING.md)).

**Needs the owner's accounts or decisions:** a Meta developer app and WhatsApp test number (before M3), Bedrock model access in the EU (before M2 can run live), AWS infrastructure setup (before M4), Stripe test keys (before M5), and the pilot business's agreement (before M9).

| Milestone | Theme | Status |
|---|---|---|
| M0 | Foundation | Done |
| M1 | Availability and bookings | Done |
| M2 | Agent core | In progress |
| M3 | WhatsApp | Planned |
| M4 | AWS platform | Planned |
| M5 | Deposits | Planned |
| M6 | Reminders and handoff | Planned |
| M7 | Owner dashboard | Planned |
| M8 | Eval suite | Planned |
| M9 | Pilot | Planned |

---

## M0: Foundation ✅

- **Closes:** FR-CF-1, NFR-8 (token pipeline), NFR-10 (test gates), NFR-11 (local stack)
- **Delivered:** npm workspaces, strict TypeScript, quality gates, CI, design tokens and CSS, Prisma schema, business config schema and seed.

## M1: Availability and bookings ✅

- **Closes:** FR-BK-1, FR-BK-2, FR-BK-3, FR-BK-4, FR-BK-5
- **Build:** `packages/core/availability.ts`, pure with no I/O: slots from hours, duration, buffers, capacity, bookings and holds, in the business timezone. Hold creation and replacement (one per conversation, 15-minute TTL), booking from a hold, cancel and reschedule with the policy window. A per-business slot lock, with a lane exclusion constraint as a database backstop, so a race can't double-book ([ADR 0010](adr/0010-booking-concurrency.md)).
- **Done when:** unit tests pass for closed day, end-past-close, buffer, capacity 2, hold blocking and DST, plus one concurrent double-booking test.

## M2: Agent core

Implemented: model loop, Bedrock adapter, validated runtime configuration and business tools with a tenant-scoped Postgres adapter. Hold and handoff executions are replay-safe. Conversation orchestration now supplies bounded context, classification, terminal handoffs, safe replies and an injected trace-store contract. The Postgres adapter now claims each inbound message once and persists context, replies, tool steps, per-model usage, estimated costs and task failures. The CLI and 16 deterministic YAML scenarios are implemented. Live Bedrock smoke tests/evals remain blocked by model authorization, so M2 is not yet marked done.

- **Closes:** FR-AG-1, FR-AG-2, FR-AG-3, FR-AG-4, FR-HO-2, GR-1, GR-2, GR-5, GR-7, NFR-4, NFR-6
- **Build:** a `ModelClient` interface with an Amazon Bedrock Converse adapter (step cap, tool errors returned to the model, timeout). Tools `get_services`, `check_availability`, `hold_slot`, `answer_faq` and `handoff_to_owner`, each with a Zod schema and a policy check. `AgentRun` and `AgentStep` persistence, a token budget, forced handoff triggers, a system prompt that treats customer text as data, `npm run chat` for CLI conversations, and the first 10 eval scenarios.
- **Done when:** a CLI conversation books a hold for a real slot, an invented time is refused by `hold_slot`, every turn leaves a full trace, and the injection and unknown-question scenarios end correctly.

## M3: WhatsApp

- **Closes:** FR-CH-1, FR-CH-2, FR-CH-3, NFR-1, NFR-2, NFR-5, NFR-9, GR-4
- **Build:** the Express webhook with Meta signature verification and dedupe by message id; a BullMQ inbound queue with per-conversation ordering; the agent worker; an outbound queue with retries, a rate limit, the 24-hour window check and a dead-letter queue; the degraded fallback; logs scrubbed of PII.
- **Done when:** integration tests for signature, dedupe, ordering and retry pass, and a local tunnel lets a real phone chat with the agent.

## M4: AWS platform

- **Closes:** NFR-11
- **Build:** CDK stacks for the network, ECS Fargate services behind an ALB, RDS Postgres, ElastiCache, Secrets Manager and Bedrock access. A `deploy.yml` GitHub Actions workflow using OIDC. Move `trust proxy` in `apps/api/src/app.ts` from `loopback` to the ALB. Alarms, SLOs, runbooks and a cost report. Cut over from the legacy server, then remove `deploy/` and its GitHub secrets.
- **Done when:** a merge to `main` deploys to ECS, a failed release rolls back, and the live WhatsApp test number replies.

## M5: Deposits

- **Closes:** FR-PY-1, FR-PY-2, FR-PY-3, GR-1, GR-3, NFR-2
- **Build:** the `create_deposit_link` tool (amount from config, hold id in metadata); a Stripe webhook with signature check and event-id idempotency; a payments worker that is the only path to `confirmed`; a hold-expiry job.
- **Done when:** a test-card deposit confirms the booking once, even with the webhook replayed, and an unpaid hold expires and frees the slot.

## M6: Reminders and handoff

- **Closes:** FR-RM-1, FR-RM-2, FR-HO-1, FR-HO-3, GR-6, FR-CH-4 (stretch)
- **Build:** BullMQ delayed jobs for the 24-hour and 2-hour reminders, removed on cancel; YES and CANCEL reply handling; the owner WhatsApp notification with summary and link; takeover and hand-back by reply; agent silence while the state is `owner`. The Twilio SMS adapter if time allows.
- **Done when:** integration tests for reminder scheduling, takeover silence and hand-back pass.

## M7: Owner dashboard

- **Closes:** FR-DB-1, FR-DB-2, FR-DB-3, FR-DB-4, FR-DB-5, FR-DB-6, NFR-7, NFR-8
- **Build:** a Next.js app on the design system with `/styleguide`; the three-pane shell, ConversationList, thread view, StatusBadge and TakeoverToggle; magic-link sign-in with per-business scoping; a bookings view with no-show marking; TraceTimeline per agent turn; a settings editor validated by the config schema.
- **Done when:** `audit:tokens`, `audit:units` and axe pass; the takeover toggle pauses the agent end to end; e2e tests cover auth isolation, bookings, traces and a settings edit that changes the agent's next answer.

## M8: Eval suite

- **Closes:** EV-1, EV-2, EV-3, EV-4, EV-5, NFR-3, GR-7
- **Build:** 40+ YAML scenarios (30 core and 10+ adversarial); the persona simulator on the small model; deterministic database-state assertions; a report with pass rate, cost per booked conversation, p95 latency and handoffs split into correct and unnecessary. A CI gate compares against the last release.
- **Done when:** `npm run eval` publishes the report, a deliberately broken prompt fails CI, and the baseline is recorded below.

## M9: Pilot

- **Closes:** EV-6
- **Build:** load the pilot business config and get the owner's sign-off on services, prices and policy. Make a real test booking with a deposit and refund it. Finish the README with the architecture diagram, guardrails and eval table.
- **Done when:** the pilot is live, and the first production traces are reviewed and turned into eval cases.

---

## Requirement coverage

Every requirement ID appears in at least one milestone. Re-check after any edit:

```sh
diff <(grep -oE '\b(FR|NFR|GR|EV)-[A-Z0-9-]*[0-9]\b' docs/REQUIREMENTS.md | sort -u) \
     <(grep -oE '\b(FR|NFR|GR|EV)-[A-Z0-9-]*[0-9]\b' docs/ROADMAP.md | sort -u)
```

## Eval results

| Date | Change | Pass rate | Cost / booked conversation | p95 latency | Handoffs (correct / unnecessary) | Notes |
| ---- | ------ | --------- | -------------------------- | ----------- | -------------------------------- | ----- |
|      |        |           |                            |             |                                  |       |
