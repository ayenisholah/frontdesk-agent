# ADR 0017: Manual, migration-first AWS releases

- Status: Accepted
- Date: 2026-11-06
- Clarifies the rollout of [ADR 0008](0008-github-actions-oidc-deploy.md).

## Context

The runtime foundation has separate application and migration privileges but no
release automation. Infrastructure provisioning and provider activation remain
deferred. The first deployment needs a controlled gate and evidence before
switching to automatic releases.

## Decision

Prepare a manual GitHub Actions workflow on main, disabled unless explicitly
enabled, using the protected production environment and immutable repository OIDC
subject. Verify environment protections and successful CI/CodeQL for the selected
main-branch commit before AWS access. Build images before assuming credentials.

Keep CloudFormation as the owner of runtime state. Separate application and
migration release parameters; update the migration image and require a successful
one-off task before promoting application images. Use only the existing stack
template. A restricted CloudFormation execution role handles ECS resource updates;
the GitHub role cannot provision infrastructure or manage IAM.

On application failure, restore previous application parameters and verify them.
Do not reverse migrations. Retain sanitized release manifests for diagnostics and
compatible application recovery. First deployment failure restores zero tasks.

## Consequences

Deployment code is testable without AWS access. Infrastructure changes remain a
separate administrative operation. The migration runner is privileged database
code, so control over the deployment role or reviewed workflow is security
sensitive even without direct secret-read permissions. Process crashes can require
manual recovery; successful offline tests do not establish live AWS readiness.
Automatic main-triggered deployment follows a successful deployment/rollback drill.
