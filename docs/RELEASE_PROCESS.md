# Release process

## Environments

| Environment | Purpose | Status |
| --- | --- | --- |
| Local | Development with `docker compose` | Available |
| CI | Throwaway Postgres on each run | Available |
| Production (AWS) | ECS, RDS, ElastiCache | Planned, M4 |
| Legacy server | Last release before the AWS move | Frozen; no deploys |

## Change flow

Feature branch → pull request → green checks → rebase merge. See [Contributing](../CONTRIBUTING.md).

Today nothing deploys automatically. The prepared `deploy.yml` workflow is manual-first and disabled until its AWS and GitHub prerequisites are configured. See [deployment automation](AWS_DEPLOYMENT.md) and [ADR 0017](adr/0017-manual-aws-releases.md). Automatic deployment after successful main CI remains planned.

## Versioning and changelog

`release-please` reads Conventional Commits on `main` and maintains a release pull request with the version and `CHANGELOG.md`. Merging it tags the release. `feat` raises the minor version, `fix` the patch, and a breaking change the major (minor while below 1.0).

Pull requests opened by the default Actions token don't trigger other workflows, so required checks won't start on release pull requests. Close and reopen the pull request to start them, or give the action a dedicated token.

## Database migrations

Use expand and contract, so old and new code can run during a deploy:

1. **Expand:** add new columns or tables, nullable or with defaults.
2. **Migrate:** deploy code that writes both forms, then backfill.
3. **Contract:** remove the old form in a later release.

The prepared AWS pipeline runs the one-off migration image before changing application image parameters. Only a zero migration exit code permits promotion. Runtime grants are refreshed after each migration.

A destructive change never ships in the same release as the code that stops using the old form.

## Rollback

- **Application (from M4):** redeploy the previous image. ECS deployment circuit breakers handle a failed rollout.
- **Database:** migrations roll forward. Expand and contract keeps the previous release working, so rolling back the application doesn't need a schema rollback.

Runbooks, SLOs and alarms are written in M4 with the infrastructure they describe.
