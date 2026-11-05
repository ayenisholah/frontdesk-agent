# 0005: Guardrails enforced in code, not prompts

**Status:** Accepted

## Context

Model output can't be trusted with money or commitments: a prompt injection, or plain error, must not change a price or confirm a booking.

## Decision

Rules GR-1 to GR-7 in the [requirements](../REQUIREMENTS.md) are enforced by deterministic code. Prices and deposits come from config, slots come from the availability engine, and only the Stripe webhook path can confirm a booking. Prompts may describe these rules but never enforce them.

## Consequences

- Every side-effecting tool needs a Zod schema, a policy check and an idempotency key.
- Each guardrail has a unit test that doesn't depend on model behaviour, plus eval coverage where it applies.
- The agent will sometimes refuse or hand off when a looser system would answer. That is the intended tradeoff.
