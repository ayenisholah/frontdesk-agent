# Contributing

## Setup

Needs Node 24 and Docker.

```sh
cp .env.example .env
npm ci                 # also installs the git hooks
docker compose up -d postgres redis
npm run db:generate && npm run db:deploy
npm run check
```

`npm run check` needs `DATABASE_URL` in your shell, because database tests are skipped without it and the coverage gate then fails.

## Workflow

1. Branch from `main`, one branch per feature: `feat/availability-engine`, `fix/hold-expiry`, `docs/threat-model`.
2. Make atomic commits as you go.
3. Run `npm run check`.
4. Push and open a pull request using the template.
5. When checks are green, it lands by rebase merge.

**Nobody pushes directly to `main`.** A local hook blocks it, and branch protection enforces it.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org): `type(scope): summary`.

- One purpose per commit. Each commit should build and pass tests alone.
- Tests go in the same commit as the code they cover.
- Describe the change, not when it happened: schedule labels are rejected.

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`, `perf`, `style`, `revert`.
Scopes usually name a workspace: `api`, `worker`, `dashboard`, `core`, `agent`, `channels`, `db`, `design`.

## Pull requests

- Keep them to one feature. List the requirement IDs they close.
- Meet the definition of done in [Engineering standards](docs/ENGINEERING_STANDARDS.md).
- Record significant decisions as an [ADR](docs/adr/README.md).
- Update the [threat model](docs/THREAT_MODEL.md) when adding a trust boundary, tool, webhook or data store.

## Security

Report vulnerabilities privately. See [SECURITY.md](SECURITY.md).
