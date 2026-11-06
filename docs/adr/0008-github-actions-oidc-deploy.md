# 0008: GitHub Actions deploys to AWS through OIDC

**Status:** Accepted; manual-first rollout clarified by [ADR 0017](0017-manual-aws-releases.md).

## Context

The legacy deploy used a stored SSH key. Production on AWS needs a pipeline with no long-lived credentials.

## Decision

GitHub Actions stays the only CI/CD system. A `deploy.yml` workflow assumes an AWS IAM role through OIDC, pushes the image to ECR and updates ECS. The role's trust policy is limited to this repository and the `production` environment.

## Consequences

- No AWS access keys are stored in GitHub.
- CodePipeline isn't used, so there is one pipeline to maintain.
- Until M4 lands, nothing deploys automatically and the legacy server stays on its last release.
