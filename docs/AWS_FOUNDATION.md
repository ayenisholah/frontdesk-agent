# AWS foundation

M4.1 prepares infrastructure locally; it does not deploy or activate providers.
The CDK workspace currently implements configuration validation, protected stack
scaffolding, retained API/worker image repositories, offline synthesis and security checks. The two-zone network and ECS cluster are implemented. Managed data
resources remain planned in the next feature PR.

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
