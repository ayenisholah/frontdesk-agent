# 0001: npm workspaces monorepo

**Status:** Accepted

## Context

The API, worker and dashboard share domain rules, the data model and the design system. They need to change together and be tested together.

## Decision

Use one repository with npm workspaces: `apps/{api,worker,dashboard}` and `packages/{core,agent,channels,db}`. Don't add a build orchestrator such as Turborepo.

## Consequences

- A change across packages is one pull request, and shared code has one home.
- With seven workspaces, plain npm scripts are fast enough. Revisit if CI time becomes a problem.
- Boundaries aren't enforced by package separation alone, so `dependency-cruiser` enforces them in CI.
