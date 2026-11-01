# Frontdesk — Build Plan (1 hour a day)

**Updated:** 2026-11-01 · **Start:** Monday 2 November 2026 · **Pilot live target:** Sunday 15 November 2026
**Related:** [PRD](PRD.md) · [Requirements](REQUIREMENTS.md) · [Design system](DESIGN_SYSTEM.md) · [SPEC](../SPEC.md) · [Overall agent plan](../../job_search/preparation/agent-build-plan.md)

There are 14 sessions of about 60 minutes each. Each session closes specific requirement IDs and ends with a "done when" check that runs green. If a session overruns, its leftover becomes the first item of the next session, and the plan shifts by a day rather than skipping work.

**Session rhythm:** 5 minutes reading the last log entry → 45 minutes building → 10 minutes to commit, run checks and log.

**Needs your go-ahead or your hands** (flagged on the day): creating the GitHub repo (Day 1), a Meta developer app and WhatsApp test number (before Day 7), Stripe test keys (before Day 9), a DNS A record and server provisioning with sudo (Day 8), and the pilot business's agreement (before Day 14).

---

## Session 0 (Sun 1 Nov): docs ✅

PRD, requirements, design system with tokens, this build plan, and SPEC updated for OpenAI.

## Day 1 (Sun 1 Nov, moved up): monorepo skeleton and CI ✅
- **Closes:** NFR-8 (token pipeline), NFR-10 (CI), NFR-11 (compose)
- **Build:** npm workspaces (`apps/api`, `apps/worker`, `apps/dashboard`, `packages/core`, `packages/agent`, `packages/channels`, `packages/db`); TypeScript strict; ESLint and Prettier; Vitest; `docker-compose.yml` with Postgres 16 and Redis 7. Port the token scripts from PPP: `build-tokens.ts`, `audit-contrast.ts`, `audit-units.mjs`. GitHub Actions for lint, typecheck, test, `tokens --check` and `audit:units`.
- **Ask first:** `git init` and creating the GitHub repo (public or private).
- **Done when:** `docker compose up -d && npm test` is green locally and in CI.

## Day 2 (Tue 3 Nov): data model and config
- **Closes:** FR-CF-1
- **Build:** the Prisma schema from SPEC (`Business`, `Service`, `OpeningHours`, `Customer`, `Conversation`, `Message`, `Hold`, `Booking`, `Payment`, `AgentRun`, `AgentStep`); a Zod business-config schema; a seed fixture for the pilot groomer, adapted from PPP's services and policies.
- **Done when:** migrations apply, the seed loads, and invalid-config unit tests fail as expected.

## Day 3 (Wed 4 Nov): availability engine
- **Closes:** FR-BK-1, NFR-10
- **Build:** `packages/core/availability.ts`, pure with no I/O. Slots come from hours, duration, buffers, capacity, bookings and holds, in the business timezone. Use PPP's `lib/booking.ts` and `lib/time.ts` as reference.
- **Done when:** unit tests pass for closed day, end-past-close, buffer, capacity 2, hold blocking and DST.

## Day 4 (Thu 5 Nov): holds, bookings and policy
- **Closes:** FR-BK-2, FR-BK-3, FR-BK-4, FR-BK-5
- **Build:** hold creation and replacement (one per conversation, 15-minute TTL), booking from a hold, and cancel and reschedule with the policy window. Add a database exclusion constraint so overlapping confirmed or pending bookings can't exist, even under a race.
- **Done when:** unit tests plus one concurrent double-booking test pass.

## Day 5 (Fri 6 Nov): agent loop and CLI harness
- **Closes:** FR-AG-1, FR-AG-2, GR-1, GR-2, GR-5
- **Build:** a `ModelClient` interface with an OpenAI Responses adapter (pattern from PPP `lib/chat.ts`: strict function tools, step cap, tool errors returned to the model, timeout). Tools `get_services`, `check_availability` and `hold_slot`, each with a Zod schema and a policy check. The step cap is 6, then handoff. Add `npm run chat`, a CLI conversation against the seed business.
- **Done when:** a CLI conversation books a hold for a real slot; an invented time is refused by `hold_slot`.

## Day 6 (Sat 7 Nov): traces, FAQ, handoff triggers
- **Closes:** NFR-4, NFR-6, FR-AG-3, FR-AG-4, FR-HO-2, GR-7
- **Build:** `AgentRun` and `AgentStep` persistence (model, prompt version, tool I/O, tokens, cost, latency, outcome); a token budget; the `answer_faq` tool over owner FAQs; the `handoff_to_owner` tool with forced triggers; a system prompt that treats customer text as data. Write the first 10 eval scenarios now, for early signal.
- **Done when:** every CLI turn leaves a full trace; the injection and unknown-question scenarios end correctly.

## Day 7 (Sun 8 Nov): WhatsApp in and out
- **Closes:** FR-CH-1, FR-CH-2, FR-CH-3, NFR-1, NFR-2, NFR-5, NFR-9, GR-4
- **Build:** the Express webhook with Meta signature verification and dedupe by message id; a BullMQ inbound queue with per-conversation ordering; the agent worker; an outbound queue with retries, a rate limit, the 24-hour window check and a dead-letter queue; the degraded fallback; logs scrubbed of PII.
- **Before:** a Meta developer app and WhatsApp test number (your account).
- **Done when:** integration tests for signature, dedupe, ordering and retry pass, and a local tunnel lets you chat from your phone.

## Day 8 (Mon 9 Nov): deploy (pipeline done early on Day 1; WhatsApp-facing checks remain)
- **Closes:** NFR-11
- **Build:** a deploy workflow to the demo server (port 3110, a systemd unit or container), using the provision flow from earlier demos. The health check covers the API, worker, Redis and Postgres.
- **Needs you:** a DNS A record for `frontdesk.sholaayeni.xyz`, and running the provision script with sudo in your own terminal.
- **Done when:** a push to `main` deploys, and the live WhatsApp test number replies.

## Day 9 (Tue 10 Nov): deposits
- **Closes:** FR-PY-1, FR-PY-2, FR-PY-3, GR-1, GR-3, NFR-2
- **Build:** the `create_deposit_link` tool (amount from config, hold id in metadata); a Stripe webhook with signature check and event-id idempotency; a payments worker that is the only path to `confirmed`; a hold-expiry job.
- **Before:** Stripe test keys. Pick the pilot business by today (a PRD open question).
- **Done when:** a test-card deposit confirms the booking once, even with the webhook replayed; an unpaid hold expires and frees the slot.

## Day 10 (Wed 11 Nov): reminders and owner handoff
- **Closes:** FR-RM-1, FR-RM-2, FR-HO-1, FR-HO-3, GR-6, FR-CH-4 (stretch)
- **Build:** BullMQ delayed jobs for the 24h and 2h reminders, removed on cancel; YES and CANCEL reply handling; the owner WhatsApp notification with summary and link; takeover and hand-back by reply; agent silence while the state is `owner`. Add the Twilio SMS adapter if time allows.
- **Done when:** integration tests for reminder scheduling, takeover silence and hand-back pass.

## Day 11 (Thu 12 Nov): dashboard shell, conversations, takeover
- **Closes:** FR-DB-2, FR-DB-3, NFR-7, NFR-8
- **Build:** a Next.js app on the design system: ported reset, base, layout and components, the generated tokens, `/styleguide`. Add the three-pane shell, ConversationList, the MessageBubble thread view, StatusBadge and TakeoverToggle.
- **Done when:** `audit:tokens`, `audit:units` and axe pass, and the takeover toggle pauses the agent end to end.

## Day 12 (Fri 13 Nov): dashboard auth, bookings, traces, settings
- **Closes:** FR-DB-1, FR-DB-4, FR-DB-5, FR-DB-6
- **Build:** magic-link sign-in with per-business scoping; a bookings view with BookingCard and no-show marking; TraceTimeline per agent turn; a settings editor validated by the config schema.
- **Done when:** e2e tests for auth isolation, booking view, trace view and a settings edit that changes the agent's next answer.

## Day 13 (Sat 14 Nov): eval suite and CI gate
- **Closes:** EV-1, EV-2, EV-3, EV-4, EV-5, NFR-3, GR-7
- **Build:** 40+ YAML scenarios (30 core and 10+ adversarial); the persona simulator on the small model; deterministic database-state assertions; a report with pass rate, cost per booked conversation, p95 latency and handoffs split into correct and unnecessary. The CI gate compares against the last release.
- **Done when:** `npm run eval` publishes the report, and a deliberately broken prompt fails CI. Record the **baseline** in the results table below.

## Day 14 (Sun 15 Nov): pilot go-live and write-up
- **Closes:** EV-6
- **Build:** load the pilot business config and get the owner's sign-off on services, prices and policy. Make a real test booking with a deposit and refund it. Write the README (architecture diagram, guardrails, eval table) and record a 2-minute video.
- **Needs you:** the pilot owner's agreement and their WhatsApp number setup.
- **Done when:** the pilot is live, and the first production traces are reviewed and turned into eval cases.

**After Day 14:** a daily 15-minute trace review during the pilot; the NFTTOOLS Triage Agent starts (see the overall agent plan).

---

## Requirement coverage

Every requirement ID appears in at least one session above. Re-check after any edit:

```sh
diff <(grep -oE '\b(FR|NFR|GR|EV)-[A-Z0-9-]*[0-9]\b' docs/REQUIREMENTS.md | sort -u) \
     <(grep -oE '\b(FR|NFR|GR|EV)-[A-Z0-9-]*[0-9]\b' docs/BUILD_PLAN.md | sort -u)
```

## Eval results

| Date | Change | Pass rate | Cost / booked conversation | p95 latency | Handoffs (correct / unnecessary) | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |

## Session log (newest first)

```
### 2026-11-01 — Day 1
Shipped: npm workspaces (apps/api, worker, dashboard; packages/core, agent, channels, db). API with /healthz and /readyz (Postgres, Redis), Zod config, JSON logs, graceful shutdown. Design system CSS on Frontdesk tokens: ported PPP layers, plus status badges, thread and trace patterns, and brand/highlight tokens. Hardened Dockerfile, compose files. CI with lint, typecheck, 16 tests, token audits, npm audit, gitleaks, image smoke test, and deploy over a forced-command SSH key with rollback. Public repo https://github.com/ayenisholah/frontdesk-agent with secret scanning and push protection. Server: freed 13.7 GB (95% → 61% used), bootstrapped ~/frontdesk.
Evals: none yet.
Blockers: the deploy key's authorized_keys line must be added by the owner; DNS A record for frontdesk.sholaayeni.xyz; one sudo session for setup-host, reclaim-system and teardown-demos.
Tomorrow's first step: Day 2, the Prisma schema and config schema.

### 2026-11-01 — Session 0
Shipped: PRD, REQUIREMENTS (FR/NFR/GR/EV with acceptance checks), DESIGN_SYSTEM + design/tokens.ts + design/fluid.ts (all 32 contrast pairs pass in both themes, no px), BUILD_PLAN, SPEC switched to OpenAI.
Evals: none yet.
Blockers: none. Day 1 needs a yes on creating the GitHub repo.
Tomorrow's first step: npm workspaces skeleton + docker-compose.yml.
```
