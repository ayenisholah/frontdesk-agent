# 0006: 100% coverage gate and evals as a release gate

**Status:** Accepted

## Context

The product acts unattended with real customers and money. Untested error paths are where it would fail.

## Decision

Enforce 100% line, branch, function and statement coverage per file on `apps/*/src` and `packages/*/src`, with a short list of justified exclusions. Agent behaviour is gated separately by the eval suite, because coverage says nothing about model quality.

## Consequences

- Code has to be built for testing: injected dependencies and thin entrypoints.
- Coverage shows code ran, not that assertions are meaningful, so review still checks test quality.
- Tooling outside `src` has lighter checks. See the [test strategy](../TEST_STRATEGY.md).
