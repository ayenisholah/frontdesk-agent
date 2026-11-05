# Security

## Reporting a vulnerability

Please report security issues privately via [GitHub's private vulnerability reporting](https://github.com/ayenisholah/frontdesk-agent/security/advisories/new) or by email to ayenisholah@gmail.com. Don't open a public issue. You'll get a reply within 3 working days.

## Current controls

- **No secrets in the repository.** CI scans the full history with gitleaks on every pull request, and GitHub secret scanning with push protection is on.
- **Protected changes.** `main` changes only through pull requests with passing checks. GitHub Actions are pinned to commit SHAs, and CodeQL and Dependabot run on the repository.
- **No self-hosted runners.** All CI runs on GitHub-hosted runners, so code from a fork can never execute on a host we run.
- **Images are bound to commits.** CI checks that each image's `org.opencontainers.image.revision` label equals the commit it was built from.
- **Hardened containers.** The image runs as a non-root user. The legacy server's compose file also sets a read-only root filesystem, drops all Linux capabilities, and sets `no-new-privileges`.
- **Guardrails in code, not prompts.** Prices, deposit amounts and booking confirmation never come from model output. See [REQUIREMENTS.md](docs/REQUIREMENTS.md) (GR-1 to GR-7). These land with the agent in milestones M2 and M5.

## Deployment status

Automatic deployment is paused while the project moves to AWS. `deploy/server/` holds the legacy single-server scripts until cutover, and CI no longer runs them. The target uses GitHub Actions with short-lived OIDC credentials, so no long-lived AWS keys are stored: see [ADR 0008](docs/adr/0008-github-actions-oidc-deploy.md).

The [threat model](docs/THREAT_MODEL.md) lists each threat, its control and whether that control exists yet.
