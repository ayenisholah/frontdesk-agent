# 0012: Durable agent turns and controlled replies

**Status:** Accepted

## Decision

Keep the custom Bedrock Converse loop. The agent defines a store contract and the
database implements it; the agent has no database dependency. A business-scoped
transaction claims a trigger message once, without holding a database transaction
across network calls. The same conversation cannot have overlapping unfinished
runs. A unique conversation/trigger constraint backs up the claim logic.

Record model usage and steps incrementally. Mutating tool calls commit their
execution key, input signature and result in the same transaction as their side
effect. Repeated keys return the original result; different input under the same
key is refused. An interrupted run remains blocked for operator review.

The small model classifies semantic handoff triggers. The code makes identified
handoffs terminal, counts task failures across turns and stops at six tool steps.
Both models share one token budget. Model free text is not delivered: factual
replies render configured services, engine slots, hold results or indexed FAQ
answers. Clarifications are selected from a fixed vocabulary.

## Consequences

The initial conversational surface is intentionally limited. Model classification
and tool selection still require live evals; deterministic scripts prove policy
and persistence behavior only. Trace payloads, replay results and stored replies
are customer content and need the planned retention/access controls. A provider
failure may have unreported billable tokens; recorded usage is an estimate, not
an invoice. M3 supplies ordered queues and recovery operations, M5 confirms paid
bookings, and M6 delivers owner notifications.
