# Data privacy

This records how data is meant to be handled. It isn't legal advice. Applicable law depends on where the pilot business and its customers are, which isn't decided; a legal review is required before the pilot (M9).

## Data classes

| Class | Examples | Stored in | Handling |
| --- | --- | --- | --- |
| Customer personal data | Phone number, name | `Customer` | Never in logs |
| Customer content | Message bodies, tool inputs and outputs | `Message`, `AgentStep` | Never in logs; retention below |
| Payment references | Stripe ids, amounts | `Payment` | Card data never reaches us; Stripe holds it |
| Business config | Services, prices, hours, FAQ | `Business`, `Service`, `OpeningHours` | Editable by the owner |
| Credentials | Provider tokens, database passwords | Secrets Manager (AWS target) | Never in the repository or logs |

## Who receives data

| Processor | Data | Purpose |
| --- | --- | --- |
| AWS (hosting, Bedrock) | All stored data; message text for inference, processed in the EU | Hosting and model calls |
| Meta (WhatsApp) | Phone numbers, messages | Delivery |
| Twilio (SMS, stretch) | Phone numbers, messages | Delivery |
| Stripe | Deposit details | Payment |

WhatsApp intake discards raw payloads, media metadata and profile names. Unsupported
messages store a fixed placeholder. `InboundWork` holds message references and
timestamps without duplicating message content, and is deleted with its message.

## Retention

- Message bodies are kept 90 days by default, and this is configurable (NFR-5).
- `AgentStep`, `ToolExecution` and `AgentRun.reply` content must follow the same limit, because they can contain message text.
- Booking and payment records may need longer retention for accounting; decide before the pilot.

The retention job is **planned** (M3). Until it exists, no real customer data goes into the system.

## Deletion

Deleting a business cascades to its services, customers, conversations and bookings in the schema. A deletion path for a single customer's data is required before the pilot.

## Test data

The repository is public, so fixtures are fictional, like Harbor Paws in `packages/core/src/fixtures/`. Never commit real customer or business data, and don't name real businesses or prospects in docs.
