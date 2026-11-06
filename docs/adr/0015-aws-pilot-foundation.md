# 0015: Offline AWS pilot foundation

**Status:** Accepted

## Decision

Prepare CDK infrastructure in three feature PRs: validation, network/container
foundation, then stateful services. Synthesis and tests use a fictional account,
explicit zones and no AWS lookups. Deployment is a separate feature.

The selected pilot topology is eu-west-1, two availability zones, one NAT gateway,
single-AZ PostgreSQL and one node-based Redis instance. This deliberately trades
automatic failover for lower fixed cost. Application subnets have NAT egress;
data subnets are isolated. No application or provider traffic is activated here.

Stateful stacks have termination protection. Databases, repositories, credentials
and encryption keys are retained on removal. Data services require TLS, encryption
at rest and backups. Postgres remains authoritative for durable work; Redis jobs
can be reconstructed, and snapshots are not a guarantee of zero job loss.

No static deployment credentials, secrets in templates, or account-specific
lookups are needed for CI. Security findings fail strict synthesis. Exceptions
must name individual rules/resources and explain the pilot tradeoff.

## Consequences

Before deployment, verify real account/zone and engine availability, obtain a
current cost estimate, review the CloudFormation diff, and configure deployment
access. A NAT or data-node outage can interrupt service; this pilot is not a
high-availability production topology. M4 remains incomplete until deployment,
rollback and live provider acceptance are proven.
