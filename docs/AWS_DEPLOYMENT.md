# Manual AWS release automation

M4.3 implements deployment automation as code. No AWS stacks, IAM roles,
GitHub environment rules or deployment variables have been provisioned by this
milestone. Live messaging and Bedrock remain disabled. Full M4 acceptance still
requires operational alarms, coordinated credential rotation, cost review and
cloud deployment/rollback drills.

## Workflow and release contract

The Deploy workflow accepts a full 40-character `release_sha` through manual
dispatch on `main`. It is skipped unless the repository variable
`AWS_DEPLOY_ENABLED` is exactly `true`. The `production` environment must require
a reviewer and permit only the `main` branch. Preflight verifies those protection
rules, commit ancestry, and successful push-triggered CI and CodeQL runs for the
exact commit before acquiring AWS credentials. Environment administration remains
a privileged trust boundary; maintain branch protection on workflow changes.

The workflow uses its main-branch control code and checks out the selected release
into a separate build directory. It builds all three images before assuming AWS
credentials. External actions are pinned to commit SHAs. Production runs share a
concurrency group and do not cancel active runs. GitHub may replace an older
pending run with a newer pending run; this is serialization, not a FIFO queue.

The runner verifies its AWS account, stable existing runtime stack and immutable
repositories. It publishes SHA-tagged API, worker and migration images, verifies
revision labels and records digests. A retry pulls an existing tag by digest and
checks its revision label rather than overwriting it. Repository scan-on-push
remains enabled; this workflow does not add a vulnerability scan completion gate.

Runtime stack parameters are:

| Parameter | Purpose |
| --- | --- |
| `AppReleaseSha` | API/worker image tags and reported release identity |
| `MigrationReleaseSha` | Independent one-off migration image tag |
| `ServiceDesiredCount` | Zero or one instance of each service |
| `DatabasePrepared` | Required to be `true` before desired count can be one |

Existing CDK configuration supplies the parameter defaults. Logical IDs remain
stable. CloudFormation also enforces the database-prepared condition. Future
infrastructure updates must preserve the current parameter values, rather than
resetting them to example defaults. Infrastructure changes must use a separately authorized execution role with the necessary provisioning permissions. Do not run them concurrently with application releases.

The release runner uses `UpdateStack` with `UsePreviousTemplate`; it neither
replaces the deployed template nor creates stacks. It first updates only the
migration version and runs the task in private application subnets with the worker
security group. A successful launch is insufficient: the task must stop with its
single migration container returning zero. Only then does the runner update the
application version, database-prepared status and desired count.

Success requires CloudFormation completion, the expected ECS task definitions,
one healthy running task per service, completed deployments, healthy ALB targets,
and HTTPS readiness returning the expected release SHA. Polling is bounded: 120
migration observations and 180 stack/health observations, with five-second waits
between pending responses and bounded SDK/HTTP requests. These are attempt limits,
not exact wall-clock durations. The workflow has a 90-minute total timeout.

## Prepared access stack

Set `deployment: { "enabled": true }` alongside runtime configuration to synthesize
the optional deployment-access stack. If the account already has the GitHub OIDC
provider, supply its ARN as `deployment.providerArn`; do not create a duplicate.
Without that field, the template creates a native IAM OIDC provider.

The GitHub role trusts audience `sts.amazonaws.com` and this repository's verified
immutable subject:

`repo:ayenisholah@49761315/frontdesk-agent@1441751147:environment:production`

The role can publish to the three pilot ECR repositories, inspect release health,
run/stop tasks in the pilot cluster, and update the existing runtime stack using
only the designated CloudFormation role. It can pass only that CloudFormation
role and the migration task/execution roles to their respective services. It
has no direct secret-read permission and cannot create stacks, manage IAM or modify network/data
infrastructure. The separate CloudFormation role can register/deregister the
three task families and update the two existing services, passing only their
existing task/execution roles. Application task roles remain empty. Running migration code is nevertheless privileged database access; protect the workflow and deployment role accordingly.

The source-derived IAM baseline was generated with:

```sh
uvx iam-policy-autopilot@latest generate-policies \
  infra/bin/deploy.ts infra/src/release/stack.ts infra/src/release/migration.ts \
  infra/src/release/images.ts infra/src/release/verification.ts \
  --region eu-west-1 --account 111111111111 --pretty
```

That is a fictional analysis account, not a deployment target. The baseline was
reviewed and narrowed: unused stack listing/tagging/policy changes were omitted,
role passing was scoped, and Docker registry operations use CDK ECR grants.
CloudFormation's ECS resource-handler permissions are separately scoped to task
families and service ARNs using the AWS service authorization reference.
Resource-specific cdk-nag exceptions cover task revision suffixes and required
global ECR authorization/ALB health reads. ListTasks and task operations require
the exact cluster condition. Tests reject wildcard role-passing and action grants.

## Future activation prerequisites

1. Complete account/zone/version/cost checks, alarms and credential-rotation
   preparation. Provision the reviewed foundation and parameterized runtime stack
   with zero tasks, then the deployment-access stack. Infrastructure provisioning
   uses a separately authorized administrative path, not this release role.
2. Configure the issued certificate and DNS as described in [runtime preparation](AWS_RUNTIME.md).
3. Configure GitHub `production` with required reviewers and exactly one custom
   deployment branch policy: branch `main`. Preserve repository branch protection.
4. Set production environment variables `AWS_ACCOUNT_ID`, `AWS_DEPLOY_ROLE_ARN`
   and `CLOUDFORMATION_RELEASE_ROLE_ARN` from the reviewed stack outputs. No static
   AWS access keys are required. Set the repository enable flag only after all
   prerequisites are verified. Region and runtime stack name are fixed to the
   eu-west-1 pilot.
5. Manually select a successful main-branch release and approve its deployment.
   Verify the first deployment and rollback in AWS before enabling any provider.
   Automatic main-triggered deployment remains planned.

Local validation is `npm run check` with the documented Postgres/Redis services.
Offline synthesis covers foundation, runtime and deployment-access examples.
Never deploy the fictional configurations.

## Failures, recovery and evidence

The runner checkpoints `artifacts/release.json` with target account/stack, release
SHA, previous parameters, image digests, migration task ARN and a status. It never
records secret values, raw task definitions, SQL, message bodies or provider error
payloads. The workflow uploads it even after failure, retaining it for 90 days.
Archive verified successful manifests before they expire.

A migration failure leaves application parameters unchanged. A migration timeout
requests `StopTask`; inspect the task and confirm it has actually stopped before
retrying. Do not rerun a timed-out migration blindly. A failed application update
or readiness check attempts to restore the previous application SHA, prepared
flag and desired count, then verifies that state. First activation failure returns
the services to zero tasks. Database migrations and the migration image parameter
are never rolled back.

Statuses `failed`, `rolled-back` and `rollback-failed` all fail the workflow.
`rollback-failed` requires operator investigation. A runner crash or workflow
cancellation can leave only a checkpoint, not a completed rollback; inspect actual
CloudFormation/ECS state before recovery. An unstable stack is rejected, including
`UPDATE_ROLLBACK_FAILED`; recover that infrastructure state through the separately
authorized administrative path first.

To recover a compatible application release, download a trusted successful
manifest from this repository's deployment artifacts. From the repository root,
first disable the GitHub enable flag and confirm no deployment or infrastructure update is in progress. With temporary credentials for the deployment role, set `DEPLOY_ENABLED=true`,
`AWS_ACCOUNT_ID`, `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION=eu-west-1`,
`RUNTIME_STACK=frontdesk-pilot-runtime`, `CLOUDFORMATION_ROLE_ARN` and a fresh numeric
`GITHUB_RUN_ID`/`GITHUB_RUN_ATTEMPT` pair. Then run:

```sh
node --import tsx infra/bin/deploy.ts --recover /absolute/path/release.json
```

Recovery validates the target and successful manifest, checks existing image
revisions/digests, and restores the recorded application's SHA with one task per
service. It performs no migrations. A missing image fails unless a matching local
image is available; retain immutable images needed for rollback. Expand/contract
schema compatibility remains a release requirement, not something the runner can
infer from a manifest.
