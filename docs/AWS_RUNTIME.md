# AWS runtime and deployment preparation

M4.2 implements optional API/worker Fargate services, HTTPS ingress, a separate
migration task and least-privileged database credentials. It prepares code and
images; no AWS deployment or provider activation has occurred. NFR-11 remains
open until cloud readiness, rollback and live acceptance are demonstrated.

## Validate locally

Run `npm run check` with Postgres and Redis available. `npm run infra:synth`
synthesizes both the foundation and runtime examples without credentials or
lookups. The runtime assembly is under `infra/cdk.out/runtime`. Both examples
contain fictional account/certificate/release values and must never be deployed.

CI builds API, worker and migration images. The migration smoke test applies
migrations twice to a disposable database, authenticates as the application role,
and verifies that role cannot create tables. Integration tests also deny access
to the migration ledger and reject elevated existing roles.

## Runtime contract

The optional `runtime` configuration requires a full 40-character release SHA,
an ACM certificate ARN in the configured account and region, and the public
hostname covered by that certificate. DNS and certificate issuance are external
prerequisites, not created by this feature. Services default to zero tasks;
`desiredCount: 1` requires `databasePrepared: true`. That assertion is an operator
attestation, not an automatic check of the database.

Both tasks run as non-root with read-only root filesystems, private subnet
placement, no public IP and no ECS Exec. HTTPS on port 443 is the only public
ingress. Only the ALB security group reaches API port 3110; the API trusts exactly
one proxy hop. Worker health/metrics remain private. Container liveness uses
`/healthz`; the ALB uses `/readyz`. ECS has deployment circuit-breaker rollback
and a 60-second container stop timeout.

Execution roles can pull the corresponding image, write the task's logs and
retrieve its injected secrets with KMS decryption. Application task roles have
no AWS API permissions. Inbound, outbound and webhook flags are false, and
Bedrock permissions are absent. The worker runs retention only.

`CLOUD_RUNTIME=true` constructs connection URLs in memory from injected
credentials. PostgreSQL uses `sslmode=verify-full`; Redis uses `rediss:`.
Ambiguous URL overrides, disabled TLS verification and missing CA configuration
fail startup. The public AWS regional RDS CA bundle is embedded in all three
images and loaded through `NODE_EXTRA_CA_CERTS`. Never replace this with
`rejectUnauthorized: false`.

The runtime database role receives SELECT/INSERT/UPDATE/DELETE on application
tables and sequence usage. It cannot change the public schema or access
`_prisma_migrations`. The one-off migration task alone receives the RDS managed
administrator credential. After every migration it reapplies runtime grants,
excluding the migration ledger, and updates the runtime role password from its
generated secret. It fails with a generic message rather than printing Prisma
output or credentials. The migration image retains build tools and a writable
filesystem; it is not a long-running service.

## Reviewed deployment sequence (not executed)

1. Verify the target account, account-specific zones, service availability,
   current costs, quotas and bootstrap state. Complete alarms, coordinated
   credential rotation and the OIDC deployment role/workflow before live
   cutover. Keep the legacy server intact.
2. Create an issued ACM certificate in eu-west-1 covering the chosen hostname.
   Prepare a private configuration file using real account/zone/certificate
   values, the reviewed release SHA, zero tasks and `databasePrepared: false`.
3. From `infra/`, run
   `INFRA_CONFIG=/absolute/path/pilot.json npx cdk synth --strict --no-lookups`,
   then review the diff. Use this direct command for the real assembly;
   `npm run infra:synth` additionally generates fictional test fixtures.
   Review replacements, retained resources, IAM, security groups and costs.
4. Deploy the reviewed network, platform and data stacks. With runtime enabled
   the platform includes a retained immutable migration repository, and the data
   stack includes the runtime credential. Build the same reviewed commit with
   Docker targets `runtime`, `worker-runtime` and `migration-runtime`, setting
   `VCS_REF` to its full SHA. Inspect revision labels, scan images, and push each
   to its matching ECR repository tagged with that SHA. Record image digests.
5. Deploy the runtime stack with zero services. Run its
   `MigrationTaskDefinitionArn` once in the application subnets, with the worker
   security group and public IP disabled. Check ECS launch failures, wait for
   STOPPED, and require the migration container's exit code to be zero.
   Never mark the database prepared merely because RunTask returned a task ARN.
6. Only after that success, set `databasePrepared: true` and `desiredCount: 1`,
   re-synthesize/review, and deploy. Create the DNS alias to
   `LoadBalancerDnsName`. Verify HTTPS with hostname validation, target health,
   API and worker readiness, release identity and graceful replacement.
   Provider flags remain disabled.
7. Record assembly, image digests, migration task ARN and readiness evidence.
   For later releases, use backward-compatible expand/contract migrations and
   require migration success before changing service images. Runtime grants
   must be refreshed after every migration.

Deployment automation using GitHub OIDC, operational alarms, cost reporting,
coordinated Redis rotation and live rollback/acceptance drills remain planned.
No credentials or cloud write permissions are added to CI by this change.

## Failure and rotation procedures

A failed migration blocks service promotion; investigate privately without
printing SQL or secret values. Do not automatically undo database migrations.
For a compatible application regression, restore the last verified image SHA
and redeploy the runtime stack. The circuit breaker helps only when a previous
healthy deployment exists; first deployment has no healthy release to restore.

Runtime password replacement requires a maintenance window: disable/drain
processing, stop tasks, update the secret, run the migration/bootstrap task to
apply the password, and replace tasks before checking readiness. A secret
update alone does not change PostgreSQL or running containers. Redis rotation
needs a separately implemented coordinated token/consumer procedure; never
rotate its Secrets Manager value alone.

## Security exceptions

Resource-scoped cdk-nag acknowledgements cover public ALB HTTPS (EC23),
non-secret environment values (ECS2), and ECR authorization's required
`Resource: "*"` (IAM5). ALB access logs are disabled (ELB2) because webhook
verification puts a token in the query string; application logs use sanitized
route labels. Runtime secret rotation (SMG4) requires the coordinated process
above. These exceptions do not grant wildcard application access or expose
database credentials.
