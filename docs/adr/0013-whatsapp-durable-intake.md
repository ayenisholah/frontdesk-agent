# ADR 0013: Durable WhatsApp intake before queue dispatch

**Status:** Accepted

## Context

Meta can retry webhooks, and a Postgres write followed by a Redis publish has a
failure gap. The receiving number must determine the tenant before messages are
stored. Customer content and secrets must not reach logs.

## Decision

Apply a per-IP request limit before body parsing and verify the raw-body HMAC
before JSON parsing. Only decimal verification challenges are accepted and the
returned value is escaped. Route through an explicitly provisioned
number-to-business registry. For each message, atomically persist the message and
a pending `InboundWork` record. Acknowledge only after commit. Serialize provider
ID deduplication and customer conversation selection with transaction-scoped advisory
locks. These locks are separate from the booking slot lock and hold no network calls.

Retain the existing unique channel/provider-message-ID constraint. Duplicate reads
are scoped to the resolved business; cross-tenant collisions fail that constraint
and roll back the transaction without reading foreign message content.
Number registrations cannot be reassigned through the provisioning command.

The inbox stores no duplicate content. Unsupported messages use a fixed placeholder.
Provider timestamps are stored separately; the customer-window timestamp cannot move
backwards or beyond receipt time. Existing owner conversations remain owner-controlled.

## Consequences

Redis outages cannot lose acknowledged messages. Partial batch retries are safe.
The inbox sequence provides durable database acceptance order; the later M3 worker
must implement per-conversation processing order and recovery. BullMQ dispatch,
retention, unsupported-type replies and outbound sending remain planned. This slice
does not close FR-CH-1's queue requirement or enable real customer traffic.

The API now bundles workspace TypeScript using esbuild, with third-party runtime
dependencies installed in the image. Prisma generation precedes bundling. No AWS
infrastructure or legacy deployment scripts change.
