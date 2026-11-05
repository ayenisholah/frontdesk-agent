# Engineering standards

These rules keep the code modular and reusable. Where a tool enforces a rule, it's named.

## Modularity

- One responsibility per module. Keep functions under 60 lines and complexity under 10 (ESLint).
- Respect the dependency direction in [Architecture](ARCHITECTURE.md) (`check:deps`).
- `packages/core` has no I/O. Pass time, IDs and data in as arguments.
- Entrypoints such as `apps/api/src/server.ts` only wire things together. Logic lives in modules they call.

## Reuse

- Search `packages/` before writing a helper. Domain rules belong in `core`, not in an app.
- Move code to a shared package on its second real use, not in anticipation of one.
- Duplicated blocks fail CI (`check:dupes`), and so do unused files, exports and dependencies (`check:unused`).
- Export only what another module imports.

## Dependency injection

Pass collaborators in as arguments, typed by the narrowest interface needed. `createChecks` in `apps/api/src/checks.ts` and `createShutdown` in `apps/api/src/lifecycle.ts` show the pattern. Tests use small fakes, not module mocks.

## Validation and errors

- Validate at every boundary with Zod: environment, webhooks, tool inputs, config.
- Parse once, then use the typed result.
- Expected outcomes are returned values, like `ParseResult` in `packages/core/src/config.ts`. Throw only for faults.
- Error responses and logs never expose secrets or internals.

## Data

- Money is integer cents. Timestamps are UTC instants, rendered in the business timezone.
- Every query on tenant data is scoped by business. See [Threat model](THREAT_MODEL.md).
- Migrations follow [Release process](RELEASE_PROCESS.md).

## Logging

Structured JSON only, through the logger. Never log message bodies, phone numbers or secrets (NFR-5).

## Naming

- Files are lowercase kebab-case; types are `PascalCase`; functions and variables are `camelCase`.
- Factory functions start with `create`. Validators start with `parse` or `assert`.
- Comments explain why, not what. Never reference schedule labels or temporary plans.

## Definition of done

- The change traces to a requirement ID or an accepted issue.
- `npm run check` passes, including the 100% coverage gate.
- Docs and ADRs reflect any changed behaviour or decision.
- Commits are atomic, and the pull request is green.
