# Security

## Reporting a vulnerability

Please report security issues privately via [GitHub's private vulnerability reporting](https://github.com/ayenisholah/frontdesk-agent/security/advisories/new) or by email to ayenisholah@gmail.com. Don't open a public issue. You'll get a reply within 3 working days.

## How deployment is secured

- **No secrets in the repository.** Database and Redis passwords are generated on the server and stored in a mode-600 file owned by the deploy user. CI scans every commit with gitleaks, and GitHub secret scanning with push protection is on.
- **No self-hosted runners.** All CI runs on GitHub-hosted runners, so code from a fork can never execute on the production host.
- **A deploy key that can do one thing.** CI's SSH key is pinned in `authorized_keys` with `restrict,command="…/deploy.sh"`: no shell, no forwarding, no PTY. The script accepts only `deploy <sha>` or `status <sha>` with a 40-character hex SHA.
- **Images are bound to commits.** CI streams the image built from the exact commit; the server rejects it unless its `org.opencontainers.image.revision` label equals the requested SHA. Input size is capped.
- **Least exposure.** Only the API is published, on `127.0.0.1`; nginx terminates TLS in front of it. Postgres and Redis sit on an internal Docker network with no published ports, and Redis requires a password.
- **Hardened containers.** Non-root user, read-only root filesystem, all Linux capabilities dropped, `no-new-privileges`, memory and process limits.
- **Automatic rollback.** If the new release isn't ready within 60 seconds, the previous release is restored.
- **Guardrails in code, not prompts.** Prices, deposit amounts and booking confirmation never come from model output. See [REQUIREMENTS.md](docs/REQUIREMENTS.md) (GR-1 to GR-7).
