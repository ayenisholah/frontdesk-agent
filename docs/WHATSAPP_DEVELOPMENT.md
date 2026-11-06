# WhatsApp intake development

M3 currently implements authenticated webhook intake and a durable Postgres inbox.
It does not dispatch BullMQ jobs, invoke the agent, or send replies. Keep it disabled
for real traffic until workers, outbound policy checks and retention are implemented.
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
