# ADR 0014: Fenced worker leases and durable delivery state

**Status:** Accepted

## Context

BullMQ can redeliver jobs after a process or Redis failure. A queue lock alone does
not protect Postgres mutations by an old worker. ADR 0012 left interrupted agent
runs blocked for manual review. M3 needs recovery without repeating booking tools.

## Decision

Postgres owns pending work, processing state and completion. Redis carries internal
IDs only. The dispatcher republishes eligible work, using stable queue job IDs;
removing a queue job never means database work has completed. Claims select the
oldest unfinished inbox sequence per conversation, while separate conversations
can run concurrently.

Claims receive a monotonically increasing token and a 90-second lease, renewed
every 20 seconds. Mutations lock and validate the token and expiry transactionally.
Lease replacement cannot race a protected mutation. Expired workers lose write
authority. No database transaction spans a provider request.

This supersedes ADR 0012's manual-only interruption policy: a recovered unfinished
run is handed off without invoking the model again, preserving completed side
effects. Completion persists the reply and its outbound work atomically.

Outbound attempts are recorded before network calls. Explicit transient rejections
can be retried; ambiguous sends become uncertain and are not automatically resent.
Status reconciliation and explicit operator resolution handle uncertainty. Owner
alerts are durable and cannot recursively generate alerts about their own failure.

## Consequences

Queue transport is at least once. Database idempotency and fencing protect internal
side effects; we do not promise exactly-once delivery by an external provider.
The per-business database lock serializes short state transitions only, not model
calls. Operators must configure sender credentials, templates and owner destinations
before enabling delivery. Content retention must preserve deduplication tombstones.

Inbox leasing, queue adapters, agent write fencing, interruption recovery and atomic
reply persistence are implemented. Delivery, retention and executable runtime
follow in separate PRs.
The roadmap and development guide record which parts are currently implemented.
