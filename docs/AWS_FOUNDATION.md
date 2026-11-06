# AWS foundation

M4.1 prepares infrastructure locally; it does not deploy or activate providers.
The CDK workspace currently implements configuration validation, protected stack
scaffolding, retained API/worker image repositories, offline synthesis and security checks. The two-zone network and ECS cluster are implemented. Protected Postgres and Redis
resources are implemented. Deployment and application service wiring remain planned.

Run `npm run infra:test` and `npm run infra:synth`. The example configuration uses
a fictional account and explicit availability zones, so no account lookup or
credentials are needed. `INFRA_CONFIG` may point to a configuration file; relative
paths resolve from `infra/`. Configuration rejects unknown fields, non-EU regions,
invalid accounts, duplicate zones and unsupported CIDRs. The pilot supports
`eu-west-1` and a private `10.x.0.0/16` VPC.

Synthesis runs cdk-nag with strict checking. No deployment workflow or credentials
are configured. Synthesized artifacts stay in ignored `cdk.out/` directories.
A real deployment requires separate account/zone verification, cost review,
bootstrap, diff review and deployment work. Do not deploy the fictional example.

## Network and containers

The network stack creates two public, two application and two isolated data
subnets. One NAT gateway serves application egress; data route tables have no
internet/default route. The default security group is restricted. API and worker
security groups allow HTTPS egress plus Postgres/Redis connections; data services
accept only those application security groups on 5432/6379. No public application
listener exists yet.

All VPC traffic produces flow records in a retained CloudWatch log group with
30-day event retention. The platform stack has an ECS cluster with Container
Insights enabled and immutable, scanned API/worker image repositories. There are
no ECS services or tasks, ALB, DNS records or certificates. Outputs contain resource
identifiers, never credentials. Explicit zones also seed CDK's zone context to
prevent indirect account lookups by constructs.

## Protected data services

The data stack creates single-AZ PostgreSQL 16 on `db.t4g.micro` with 20 GiB gp3
storage, TLS enforcement, seven-day backups and deletion protection. The engine
major matches local development; AWS selects a supported minor and automatic minor
updates are enabled. Verify the regional version before deployment. Paid extended
support is disabled. RDS manages the `frontdesk_owner` administrator credential in
Secrets Manager. That credential is for administration, not application runtime;
a least-privileged application role and migration path are still required.

Redis OSS 7.1 uses one `cache.t4g.small` node with cluster mode disabled,
`noeviction`, required TLS, AUTH and seven-day snapshots. Its 32-character token is
generated in Secrets Manager and referenced dynamically in CloudFormation. No
secret value or credential-bearing connection URL is an output. Both services use
only the isolated data subnets and their dedicated security groups.

A retained customer-managed KMS key encrypts storage and credentials and has key
rotation enabled. Databases, the Redis credential, key and log groups use retain
policies on removal/replacement. RDS PostgreSQL logs use a KMS-encrypted log group
with 30-day retention. Statement, duration and parameter logging are disabled;
error verbosity and severity are restricted to avoid logging customer SQL payloads.
Performance Insights and Redis command/slow-query logging are not enabled.

Strong cross-stack references are explicit: CloudFormation protects referenced
network resources. Keep logical IDs stable. Removing an export requires a staged
reference migration; never rename stateful constructs as a cosmetic refactor.

### Scoped security exceptions

Exceptions are attached to individual resources and written into template metadata:

| Rule | Resource | Reason |
| --- | --- | --- |
| RDS3 / AEC4 | Postgres / Redis | Owner-selected single-node pilot, without automatic failover |
| RDS11 / AEC5 | Postgres / Redis | Standard ports are limited to API/worker security groups, with TLS and authentication |
| SMG4 | Redis credential | Rotation must coordinate the cache token and consumers; implement it before live deployment |
| CloudFormation W3010 | Postgres | The explicit zone comes from validated configuration; offline synthesis cannot query account zones |

These exceptions do not permit public data access, unencrypted storage or plaintext
credentials. Redis snapshots do not promise zero queue loss; Postgres reconciliation
rebuilds due work. A shared-zone or NAT outage can interrupt the pilot.

### Before deployment

This feature makes no account changes. The next feature must verify account and
regional capacity/version availability, review current costs and bootstrap/diff,
then implement runtime TLS trust, least-privileged database access, coordinated
Redis credential rotation, ECS services, migrations, ALB, OIDC deployment,
rollback and alarms. Do not remove the legacy server or enable provider traffic
until cutover and real-phone acceptance succeed.
