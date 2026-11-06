# AWS foundation

M4.1 prepares infrastructure locally; it does not deploy or activate providers.
The CDK workspace currently implements configuration validation, protected stack
scaffolding, retained API/worker image repositories, offline synthesis and security checks. Network, compute and data
resources are planned in subsequent feature PRs.

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
