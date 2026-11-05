# 0010: Booking concurrency with a slot lock and lanes

**Status:** Accepted

## Context

The system must never double-book, even when several conversations race for the same slot. A plain Postgres exclusion constraint on overlapping bookings can't do this alone. It would reject the second booking a business with capacity 2 is allowed, and it can't see holds, which live in another table.

## Decision

Two layers:

1. **Slot lock.** Every write that claims time runs in a transaction holding `pg_advisory_xact_lock` for the business, and re-runs the availability engine inside it. This covers holds and bookings together, at any capacity.
2. **Lanes.** Each active booking takes a lane from 0 to capacity − 1. An `EXCLUDE` constraint rejects overlapping active bookings on one lane, so a bug in the lock path still can't double-book.

A partial unique index allows one active hold per conversation. An expired hold stops counting as soon as `expiresAt` passes, even before its status is updated.

Inside the lock:

- The time is read after the lock is acquired, so a long wait can't judge validity against a stale clock. Callers pass a clock function, never a fixed time.
- An unpaid booking gives up its slot at `depositDueAt`. Overdue ones are released at the start of every claim, so a slot is never stuck waiting for a job to run.
- `bookFromHold` re-runs the engine, because hours or capacity may have changed since the hold. Saving business config takes the same lock.

## Consequences

- Claims for one business run one at a time. That's fine at this volume, and different businesses don't wait on each other.
- Lanes are assigned lowest-first and don't move. After cancellations, a long job can occasionally be refused although peak capacity would allow it, because no single lane is free for its whole length. The refusal is safe, and repacking lanes can come later if it matters.
- The engine counts buffers, but the constraint doesn't. Buffers are protected by the lock layer alone.
- A customer can chain holds and unpaid bookings for different slots. Each frees itself after 15 minutes, so it can't fill a calendar for long, but M2's tools should limit a conversation to one unpaid booking.
- `btree_gist` is required. It's available on Amazon RDS.
