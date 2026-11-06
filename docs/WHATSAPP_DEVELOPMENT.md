# WhatsApp intake development

M3 currently implements authenticated webhook intake and a durable Postgres inbox.
Queue adapters and database lease primitives are available and integration-tested,
but the executable worker is not yet wired. The API does not invoke the agent or
send replies. Keep it disabled
for real traffic until the executable worker and daily retention schedule are configured.
Bedrock authorization and live M2 acceptance are deferred.

## Local setup

Use Node 24, start the local Postgres service, install dependencies, then run
`npm run db:generate` and `npm run db:deploy` with `DATABASE_URL` configured.
The webhook is disabled by default. To test with fictional data, set these in `.env`:

```dotenv
WHATSAPP_WEBHOOK_ENABLED=true
WHATSAPP_APP_SECRET=fictional-local-secret
WHATSAPP_VERIFY_TOKEN=fictional-local-verify-token
```

Provision a receiving-number registration for an existing fictional business:

```sh
npm run whatsapp:register -- --business-id BUSINESS_UUID --phone-number-id 123456789
npm run dev:api
```

The number ID is Meta's receiving `phone_number_id`, not a customer's phone number.
Registration is idempotent for the same business and refuses reassignment. There is
no public registration API. Real secrets belong in environment configuration and
must never be committed.

## HTTP contract

`GET /webhooks/whatsapp` accepts `hub.mode=subscribe`, the configured
`hub.verify_token`, and a decimal `hub.challenge` (1–32 digits). It returns the challenge as
plain text, or 403 on failure.

`POST /webhooks/whatsapp` requires `X-Hub-Signature-256: sha256=<hex>` computed
with the app secret over the exact body bytes. Signature verification precedes
JSON parsing. Both routes allow 120 requests per minute per IP per API process,
returning 429 with `Retry-After` when exceeded. This local in-memory limit is not
a fleet-wide quota; shared limiting and ALB proxy configuration belong to M4.
Bodies are limited to 1 MiB; compressed bodies are refused.

| Result | HTTP status |
| --- | --- |
| All messages committed or already present; status-only event | 200 |
| Missing or invalid signature | 401 |
| Invalid JSON/schema or unsupported encoding | 400 |
| Provider ID conflicts with an existing message | 409 |
| Body exceeds limit | 413 |
| Per-IP request limit exceeded | 429 |
| Unregistered receiving number or database failure | 503 |
| Intake disabled | 404 |

Each message commits independently. If a later batch item fails, Meta can retry
the entire batch; earlier items are deduplicated. No transaction spans provider
or model calls. Unknown event fields and delivery statuses are acknowledged but
not persisted. Unsupported message types create a fixed placeholder and an
`unsupported` inbox marker; the later outbound feature will send the type-text reply.

## Durable inbox and privacy

`InboundWork` contains references, kind, pending state, provider timestamp and
receipt timestamp. Its sequence records database acceptance order, not a guarantee
of network arrival order across concurrent requests. A future dispatcher must
preserve per-conversation order and publish IDs only to Redis.

Text is stored once in `Message`; raw payloads, media, contacts and profile names
are discarded. Existing owner conversations remain in owner mode; closed threads
start a new conversation. Duplicate delivery does not refresh the customer window.
New messages advance it monotonically using the provider timestamp capped at receipt
time. Logs contain bounded event codes and route labels, never webhook content,
phone numbers, signatures or verification query parameters.

Run `npm run check` with Postgres. Unit and integration tests use fictional signed
payloads and verify concurrent dedupe, tenant isolation, rollback, and batch replay.
Container smoke tests exercise the enabled route without contacting Meta or Bedrock.

## Queue foundation

The worker library publishes up to 100 eligible inbox IDs per business with stable
`inbound-<sequence>` job IDs. Pending work stays in Postgres, so lost Redis jobs can
be rebuilt. Only the oldest unfinished message in each conversation is eligible.
Queues use separate producer and consumer connections: producers fail promptly,
while consumers reconnect. Job payloads are strict identifier-only objects.

Inbox claims have a 90-second lease and an increasing ownership token. Renewal,
completion and pre-start retries verify the live token under a database lock.
Pre-start failures back off and become terminal after five claims. Reclaimed work
is marked as recovered so the agent worker can hand off instead of replaying
a partially executed model turn. Agent-store writes also verify the lease.

Queue integration tests require `REDIS_URL` as well as `DATABASE_URL`; they use unique
Redis prefixes and isolated databases. CI supplies both services. The local Redis
configuration uses `noeviction`. Run the complete gate with both URLs exported.

## Agent worker

The worker adapter executes `runConversationTurn` for claimed text messages. It
renews the 90-second lease every 20 seconds, cancels inference on renewal failure,
and bounds a whole turn to five minutes. The Bedrock adapter combines caller
cancellation with its existing request timeout and keeps its three-attempt SDK
retry limit. Worker-owned runs cannot be mutated without their current lease.

An interrupted run is finished as an error and handed to the owner without replaying
model calls or tools. Completed tool effects remain intact. Owner-controlled and
closed threads are skipped, except the final reply from the agent's own handoff.
Unsupported input receives a fixed request for text without calling a model.

Finishing a worker turn commits its run, reply, outbound work and inbox completion
in one transaction. History follows inbox sequence and includes replies from prior
completed turns, excluding future queued messages. CLI sandbox turns retain their
existing history behavior. Delivery adapters are implemented below; there is no
executable worker service or live sending enabled yet.

## Outbound delivery and recovery

Outbound work is ordered within a conversation. A durable attempt precedes each
provider request; no transaction spans the network call. Explicit transient
rejections get up to five attempts, with 1, 5, 30 and 120-second delays plus jitter,
honoring longer `Retry-After` values. The transport has a 15-second deadline and an
explicit Graph API version. Shared Redis reservations default to 10 messages per
second per sender and one message per six seconds per recipient; configuration
can lower those rates.

Timeouts, connection loss, malformed responses and abandoned in-flight attempts
become **uncertain**. They are never automatically resent. The conversation hands
off, and an approved owner template carries only the internal incident ID. Failure
of that alert remains visible in the incident ledger and cannot generate another
alert. Postgres is the authoritative dead-letter ledger; the dead BullMQ queue can
mirror the most recent 100 dead/uncertain references per business.

Signed status callbacks correlate the registered sender, recipient hash, attempt
ID or known provider ID. Duplicate callbacks are harmless, older callbacks are
ignored, and delivered/read states cannot regress. An operator can also record
acceptance or failure without resending; that does not hand the thread back to the
agent.

The send transaction rechecks ownership and the 24-hour customer window. Outside
that window it uses only fixed configured templates with approval verified within
24 hours; arbitrary agent replies never become template parameters. Missing or
stale approval suppresses sending and creates an incident. Only the final reply
from the agent's own handoff can pass the owner-status check.

### Provision sender metadata

The existing registration command accepts `--configure-delivery`, `--token-env`,
`--graph-version`, `--waba-id`, `--owner-phone`, `--owner-template` and
`--owner-language`. Optional `--customer-template` and `--customer-language` select
the fixed outside-window response. The token environment name must match
`WHATSAPP_*_TOKEN`; its value is never written to Postgres. The command verifies
exact template names, languages and `APPROVED` status with Meta before saving
metadata. Rerun provisioning to refresh template verification before it expires.
These live prerequisites remain deferred; tests inject HTTP responses.

### Inspect or resolve deliveries

```sh
npm run whatsapp:delivery -- --business-id BUSINESS_UUID --inspect
npm run whatsapp:delivery -- --business-id BUSINESS_UUID --resolve-id OUTBOUND_UUID --resolution accepted --provider-id PROVIDER_ID
npm run whatsapp:delivery -- --business-id BUSINESS_UUID --resolve-id OUTBOUND_UUID --resolution dead
```

Inspection returns recent internal IDs, states, attempts, reasons and timestamps,
never phone numbers or message bodies. Resolution only accepts uncertain work and
never calls the provider. There is no public administration endpoint.

## Content retention

`redactBusinessContent` processes bounded tenant-scoped batches, defaulting to
90 days and 100 messages/runs per batch. It preserves deduplication IDs, usage,
outcomes, timestamps, bookings and contact identity. It redacts message bodies,
run replies, step inputs/outputs, and tool signatures/results. Live leases delay
cleanup; expired unfinished runs close without replaying tools.

Inbox claims and outbound sends independently enforce the configured retention
limit and reject redacted records. Redelivery of a redacted provider message uses
its tenant/sender/recipient tombstone without comparing the removed body.
The executable worker's daily scheduling remains the next integration step.
