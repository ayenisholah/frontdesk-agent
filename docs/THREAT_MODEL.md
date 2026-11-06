# Threat model

**Scope:** the target system in [Architecture](ARCHITECTURE.md). Status shows what exists today. **Planned** controls don't exist yet, and the feature they protect doesn't either; each must ship with its feature.

## Assets

Customer phone numbers and messages, business config and prices, booking and payment state, AWS and provider credentials.

## Trust boundaries

Provider webhooks into `api` · customer text into the model · model output into tools · owner browser into the dashboard · CI into AWS.

## Threats and controls

| ID | Threat (STRIDE) | Control | Status |
| --- | --- | --- | --- |
| T-1 | Forged WhatsApp or Stripe webhook (Spoofing) | Signature verification before any processing (FR-CH-1, FR-PY-2) | WhatsApp implemented; Stripe planned, M5 |
| T-2 | Replayed webhook causes a second effect (Tampering) | Dedupe by provider id; `Message` is unique on channel and provider id (NFR-2) | WhatsApp intake implemented; Stripe handler planned |
| T-3 | Prompt injection changes price or policy (Tampering) | Prices from config; tool policies ignore customer claims (GR-1, GR-7) | Implemented for CLI: policy-checked tools and fixed fact rendering; live injection eval pending |
| T-4 | Model invents a slot or confirms unpaid booking (Tampering) | Engine revalidates slots; only the payments worker confirms (GR-2, GR-3) | Engine revalidation implemented; payment confirmation path planned M5 |
| T-5 | One business reads another's data (Information disclosure) | Business-scoped queries and session checks (FR-DB-1) | Planned, M7 |
| T-6 | Message bodies or phone numbers leak into logs (Information disclosure) | Log rules and a scrub test (NFR-5) | Partial: rule documented, test planned |
| T-7 | Config or system prompt leaks through chat (Information disclosure) | Injection evals (EV-3) | Planned, M8 |
| T-8 | Message floods run up model cost (Denial of service) | Token budget, step cap, rate limits (NFR-4, GR-5) | Step/token limits implemented; channel rate limits planned M3 |
| T-9 | Secret committed to the repository (Information disclosure) | gitleaks in CI and hooks; GitHub push protection | Implemented |
| T-10 | Malicious dependency or action (Tampering) | SHA-pinned actions, Dependabot, CodeQL, `npm audit` | Implemented |
| T-11 | Stolen CI credentials reach production (Elevation of privilege) | OIDC with a role scoped to this repo and environment ([ADR 0008](adr/0008-github-actions-oidc-deploy.md)) | Planned, M4 |
| T-12 | Owner takeover ignored; agent replies anyway (Tampering) | State checked before any model call (GR-6) | CLI ownership checks implemented; channel takeover planned M6 |
| T-13 | Racing conversations double-book a slot (Tampering) | Per-business slot lock and a lane exclusion constraint ([ADR 0010](adr/0010-booking-concurrency.md)) | Implemented |

## Known risks to design for

- **Tenant scoping through joins.** `Message`, `Payment`, `AgentRun` and `AgentStep` have no `businessId`; they're scoped through their parent records. A query that fetches one by id alone would cross tenants. M7 must scope these through the parent and test isolation for each.
- **Agent traces hold customer text.** `AgentStep` stores tool inputs and outputs, so retention and access rules must cover it. See [Data privacy](DATA_PRIVACY.md).
- **The legacy server** stays reachable but receives no deploys until cutover, so it gets no application fixes. Don't put real customer data on it.

## AWS runtime boundary

Prepared infrastructure restricts public ingress to the HTTPS ALB. API tasks trust one proxy hop and accept port 3110 only from its security group. Worker endpoints and data services stay private. ECS execution roles inject secrets; application roles have no AWS API permissions. Only the migration task gets database administration credentials; runtime access excludes DDL and the migration ledger. ALB access logging remains disabled to avoid capturing webhook verification tokens. This is tested infrastructure code, not a deployed control. See [runtime preparation](AWS_RUNTIME.md).

## Review

Update this document in any pull request that adds a trust boundary, tool, webhook or data store.
