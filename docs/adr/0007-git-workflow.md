# 0007: Feature branches, pull requests, rebase merges

**Status:** Accepted

## Context

History should explain the system, not the calendar. Early commits were labelled by build day and pushed directly to `main`.

## Decision

Every feature gets its own branch and pull request. `main` accepts no direct pushes. Commits are atomic Conventional Commits with no schedule labels. Pull requests land by rebase merge, so atomic commits survive; squash merges are disabled for that reason.

## Consequences

- Branch protection requires passing checks, and `commitlint` enforces the message rules in hooks and CI.
- Each commit must make sense alone, so branches may need tidying before review.
