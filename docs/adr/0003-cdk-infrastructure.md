# 0003: Infrastructure in CDK TypeScript

**Status:** Accepted

## Context

Infrastructure must be reviewable, repeatable and tested like application code.

## Decision

Define all AWS resources with CDK in TypeScript, in an `infra/` workspace. No resources are created by hand in the console.

## Consequences

- Infrastructure uses the same language, review flow and CI as the application.
- `cdk diff` output belongs in infrastructure pull requests.
- `infra/` needs its own test approach, decided in M4 and added to the [test strategy](../TEST_STRATEGY.md).
