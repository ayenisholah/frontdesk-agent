# Requirements

**Status:** Draft v1 · **Updated:** 2026-11-05
**Related:** [PRD](PRD.md) · [SPEC](../SPEC.md) · [Design system](DESIGN_SYSTEM.md) · [Roadmap](ROADMAP.md)

Every requirement has an ID, a testable acceptance check and the [roadmap](ROADMAP.md) milestone that delivers it. A check becomes a unit test, an integration test or an eval scenario: the "Verified by" column names which. "v1" items block the pilot; "stretch" items don't.

**ID prefixes:** `FR` functional · `NFR` non-functional · `GR` guardrail (enforced in code, never only in the prompt) · `EV` evaluation.

---

## Functional requirements

### Configuration

| ID | Requirement | Acceptance check | Verified by | Milestone |
|---|---|---|---|---|
| FR-CF-1 | Each business has one config: services (name, duration, price, deposit), opening hours, timezone, capacity, buffers, cancellation window, FAQ and tone. | Invalid config (negative price, overlapping hours, unknown timezone) is rejected by the Zod schema with a clear error; the pilot fixture loads. | unit | M0 |

### Channels

| ID | Requirement | Acceptance check | Verified by | Milestone |
|---|---|---|---|---|
| FR-CH-1 | Receive WhatsApp messages through the Cloud API webhook. | A signed webhook payload creates one `Message` and one inbound job; an unsigned or wrongly signed one gets 401 and creates nothing. | integration | M3 |
| FR-CH-2 | Send replies through an outbound queue with retries and a per-number rate limit. | A send that fails twice then succeeds is delivered once; a permanent failure goes to the dead-letter queue and alerts the owner. | integration | M3 |
| FR-CH-3 | Unsupported inbound types (voice note, sticker, location) get a short text reply. | A voice-note payload produces the "please type your message" reply and no agent run. | integration | M3 |
| FR-CH-4 | SMS through Twilio behind the same channel interface. *(stretch)* | The same scenario passes on both channel adapters. | integration | M6 |

### Conversation and agent

| ID | Requirement | Acceptance check | Verified by | Milestone |
|---|---|---|---|---|
| FR-AG-1 | Each inbound turn runs the agent loop with the business's tools and returns one reply. | CLI harness: "Do you have anything Saturday for a bath?" calls `check_availability` and replies with offered slots. | eval | M2 |
| FR-AG-2 | The agent keeps context: the last 20 messages plus conversation state (active hold, booking, customer name). | A multi-turn scenario that books across four messages passes without the customer repeating details. | eval | M2 |
| FR-AG-3 | Facts come only from config and the FAQ (`answer_faq`); unknown questions are handed off. | "Do you groom cats?" with no such service → a handoff, not an invented answer. | eval | M2 |
| FR-AG-4 | Non-English messages get a reply in English plus an offer to hand off. *(v1; multilingual is v2)* | A French inquiry gets the English reply with a handoff offer. | eval | M2 |

### Availability and booking

| ID | Requirement | Acceptance check | Verified by | Milestone |
|---|---|---|---|---|
| FR-BK-1 | Availability comes from opening hours, service duration, buffers, capacity, existing bookings and active holds, in the business timezone. | Unit tests cover: closed day, slot ending after close, buffer between jobs, capacity 2, an active hold blocking a slot, and a DST change. | unit | M1 |
| FR-BK-2 | `hold_slot` creates a 15-minute hold; one active hold per conversation; holds expire automatically. | A second hold replaces the first; an expired hold frees the slot. | unit + integration | M1 |
| FR-BK-3 | A booking is created as `pending_deposit` from a valid hold. | A booking can't be created without an unexpired hold for the same slot. | unit | M1 |
| FR-BK-4 | `cancel_booking` works only for the same customer and inside the policy window. | A different phone number, or a cancellation inside the window, is refused with the policy text. | unit + eval | M1 |
| FR-BK-5 | `reschedule_booking` applies FR-BK-4 plus an availability re-check. | Moving to a taken slot is refused; moving to a free slot updates the booking and frees the old slot. | unit + eval | M1 |

### Payments

| ID | Requirement | Acceptance check | Verified by | Milestone |
|---|---|---|---|---|
| FR-PY-1 | `create_deposit_link` creates a Stripe Checkout session for the hold. | The session amount equals the service deposit in config, and its metadata carries the hold id. | integration | M5 |
| FR-PY-2 | The Stripe webhook confirms the booking and sends a confirmation message. | A `checkout.session.completed` event moves the booking to `confirmed` and queues exactly one confirmation, even if delivered twice. | integration | M5 |
| FR-PY-3 | A hold that expires unpaid releases the slot and tells the customer. | After 15 minutes without payment, the slot is free again and one message offers to re-book. | integration | M5 |

### Reminders

| ID | Requirement | Acceptance check | Verified by | Milestone |
|---|---|---|---|---|
| FR-RM-1 | Reminders go out 24 hours and 2 hours before each confirmed booking. | Scheduled jobs exist for both times; a cancelled booking's reminders are removed. | integration | M6 |
| FR-RM-2 | A reply to a reminder can confirm or cancel. | "Cancel" within policy cancels; "Yes" marks the booking confirmed-by-customer. | eval | M6 |

### Handoff

| ID | Requirement | Acceptance check | Verified by | Milestone |
|---|---|---|---|---|
| FR-HO-1 | `handoff_to_owner` notifies the owner on WhatsApp with a summary and a dashboard link, and pauses the agent on that thread. | The owner receives one message with reason and summary; the conversation state becomes `owner`. | integration | M6 |
| FR-HO-2 | Handoff is forced for complaints, refund requests, pet or health issues, prices not in config, low confidence, and three failed attempts at the same task. | Each trigger has an eval scenario that ends in a handoff with the right reason. | eval | M2 |
| FR-HO-3 | The owner takes over by replying to the handoff message or with the dashboard toggle, and hands back the same way. | While the state is `owner`, inbound messages create no agent run; after hand-back, the next message does. | integration | M6 |

### Owner dashboard

| ID | Requirement | Acceptance check | Verified by | Milestone |
|---|---|---|---|---|
| FR-DB-1 | The owner signs in (email magic link); every dashboard route and API requires a session. | Unauthenticated requests get 401 or a redirect to sign-in; a session from business A can't read business B. | integration | M7 |
| FR-DB-2 | A conversation list with state badges, and a thread view of the full history. | The list shows agent, owner and closed badges and sorts by latest message; the thread shows customer, agent, owner and system bubbles. | e2e | M7 |
| FR-DB-3 | A takeover toggle, and owner replies sent from the dashboard. | Toggling sets the state to `owner`; a reply from the dashboard is delivered through the outbound queue. | e2e | M7 |
| FR-DB-4 | A bookings view for today and upcoming, with status. | Bookings show the booking-state badges from the design system; a no-show can be marked. | e2e | M7 |
| FR-DB-5 | A trace timeline for each agent turn: tools called, inputs, outputs, tokens, cost, latency. | Opening a turn shows every `AgentStep` in order, with errors highlighted. | e2e | M7 |
| FR-DB-6 | Settings to edit services, hours, policy, FAQ and tone. | An edit passes the FR-CF-1 validation and changes the next agent turn's answers. | e2e | M7 |

---

## Non-functional requirements

| ID | Requirement | Acceptance check | Verified by | Milestone |
|---|---|---|---|---|
| NFR-1 | **Ordering.** Messages in one conversation are processed in order, one at a time, while different conversations run in parallel. | Three messages sent within 1 second in one conversation produce runs in arrival order; two conversations run concurrently. | integration | M3 |
| NFR-2 | **Idempotency.** Duplicate WhatsApp message ids and Stripe event ids have no second effect. | Replaying a webhook twice yields one `Message` and one state change. | integration | M3, M5 |
| NFR-3 | **Latency.** p95 time from inbound webhook to queued reply ≤ 10 seconds. | The eval report and production traces publish p95. | eval | M8 |
| NFR-4 | **Cost.** Each turn has a token budget; tokens and cost are recorded per run. | A run that exceeds the budget stops and hands off; cost per booked conversation appears in the eval report. | unit + eval | M2 |
| NFR-5 | **Security.** Webhook signatures verified; secrets only in env; no message bodies or phone numbers in application logs; message bodies kept 90 days (configurable). | Signature tests (FR-CH-1, FR-PY-2); a log-scrub test; a retention job test. | unit + integration | M3 |
| NFR-6 | **Observability.** Every turn writes an `AgentRun` and its `AgentStep`s: model, prompt version, tool I/O, tokens, cost, latency, outcome. Logs are structured JSON. | Every eval scenario run leaves a complete trace. | integration | M2 |
| NFR-7 | **Accessibility.** The dashboard meets WCAG 2.2 AA: keyboard reachable, visible focus, 2.75rem touch targets, labelled controls. | `audit:tokens` contrast passes in both themes; an axe check passes on every dashboard route. | audit | M7 |
| NFR-8 | **Units.** No `px` in styles or tokens; media queries in `em`. | `audit:units` passes in CI. | audit | M0, M7 |
| NFR-9 | **Degradation.** An LLM or provider failure is retried with backoff; after 3 failures the customer gets a canned "the owner will reply shortly" and the thread is handed off. | Simulated 500s from the model produce the canned reply and a handoff. | integration | M3 |
| NFR-10 | **Tests.** Source in `apps/*/src` and `packages/*/src` has 100% line, branch, function and statement coverage, enforced per file, with exclusions listed in [TEST_STRATEGY](TEST_STRATEGY.md). CI runs every gate on each pull request. | `npm run check` passes locally and CI is green on every pull request. | CI | M0, M1 |
| NFR-11 | **Deployability.** `docker compose up` runs the full stack locally; merges to `main` deploy to AWS through GitHub Actions. | A fresh clone runs with one command; a merge deploys to ECS and passes a health check, and a failed release rolls back. | CI | M0, M4 |

---

## Guardrails (enforced in code)

| ID | Rule | Enforcement | Verified by | Milestone |
|---|---|---|---|---|
| GR-1 | Prices and deposit amounts always come from config, never from model output. | Tools return prices; `create_deposit_link` computes the amount server-side from the hold's service. | unit + eval | M2, M5 |
| GR-2 | The agent can offer and hold only slots the availability engine generated. | `hold_slot` re-validates the slot against the engine; an invented time is refused. | unit + eval | M2 |
| GR-3 | A booking is confirmed only by the Stripe webhook. | No tool can set `confirmed`; only the payments worker can. | unit | M5 |
| GR-4 | No outbound WhatsApp message outside the 24-hour customer window unless it's an approved template. | The outbound worker checks the window and switches to a template or drops the send with a logged reason. | unit | M3 |
| GR-5 | At most 6 tool steps per turn, then hand off. | The loop counter stops at 6 and calls `handoff_to_owner`. | unit | M2 |
| GR-6 | The agent stays silent on a thread the owner has taken over. | Inbound processing checks state before any model call. | integration | M6 |
| GR-7 | Customer text is data, never instructions: tool policies reject requests outside the rules whatever the prompt says. | The injection set (EV-3) passes: no discount, no free booking, no config leak. | eval | M2, M8 |

---

## Evaluation requirements

| ID | Requirement | Acceptance check | Milestone |
|---|---|---|---|
| EV-1 | At least 40 scenario files (YAML): customer messages, business fixture, expected outcome. Assertions are deterministic checks on database state. | `npm run eval` runs all scenarios and prints pass or fail for each. | M8 |
| EV-2 | Multi-turn scenarios use a simulated customer: the small model acting as a persona. | A scenario with persona "impatient, books for two dogs" completes. | M8 |
| EV-3 | An adversarial set of at least 10: prompt injection, wrong dates and timezones, a double-booking race, abuse, other languages. | All adversarial scenarios run in CI. | M8 |
| EV-4 | A CI gate: a pull request fails if the pass rate drops below the last release. | A deliberately broken prompt fails CI. | M8 |
| EV-5 | Each run publishes pass rate, cost per booked conversation, p95 latency, and handoffs split into correct and unnecessary. | The report is attached to the CI run and summarised in the README results table. | M8 |
| EV-6 | Failures from live traces are added to the scenario set each week. | The scenario count grows during the pilot; each new case links its trace id. | M9 |
