# ADR 0016: Separate runtime and migration privileges

- Status: Accepted
- Date: 2026-11-06

## Context

The offline foundation has protected data services but no application wiring.
Long-running containers must not receive the RDS administrator credential.
Deployment preparation must remain testable without activating live providers.

## Decision

Add an optional runtime stack with private Fargate API/worker services and an
HTTPS ALB. Default services to zero tasks and require a database-prepared
attestation before enabling one task per service. Inject generated runtime
credentials through execution roles; application roles receive no AWS API
permissions while model and messaging paths are disabled.

Package migrations as a separate one-off image/task with the RDS administrator
credential. Apply migrations before promotion, then transactionally provision
DML access for the runtime role, excluding the migration ledger. Reapply grants
after every migration. Build credential-bearing URLs only inside the processes,
with strict PostgreSQL/Redis TLS and an embedded public RDS CA bundle.

## Consequences

Offline tests and CI can verify the assembly and migration image without AWS
credentials. Runtime compromise does not directly grant schema-management or
AWS control-plane access. The preparation flag is an attestation; deployment
automation must check the migration task result. OIDC deployment, alarms,
coordinated Redis rotation, cost review and live acceptance remain separate work.
See [runtime preparation](../AWS_RUNTIME.md) for release order and failure handling.
