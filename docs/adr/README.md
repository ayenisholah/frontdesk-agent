# Architecture decision records

Each record captures one decision, its context and its consequences. Records are never rewritten: to change a decision, add a new record and mark the old one superseded.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-monorepo-workspaces.md) | npm workspaces monorepo | Accepted |
| [0002](0002-aws-ecs-fargate.md) | ECS Fargate, RDS Postgres and ElastiCache on AWS | Accepted |
| [0003](0003-cdk-infrastructure.md) | Infrastructure in CDK TypeScript | Accepted |
| [0004](0004-bedrock-model-provider.md) | Claude on Amazon Bedrock behind `ModelClient` | Accepted |
| [0005](0005-deterministic-guardrails.md) | Guardrails enforced in code, not prompts | Accepted |
| [0006](0006-testing-policy.md) | 100% coverage gate and evals as a release gate | Accepted |
| [0007](0007-git-workflow.md) | Feature branches, pull requests, rebase merges | Accepted |
| [0008](0008-github-actions-oidc-deploy.md) | GitHub Actions deploys to AWS through OIDC | Accepted |
| [0010](0010-booking-concurrency.md) | Booking concurrency with a slot lock and lanes | Accepted |
| [0011](0011-bedrock-region-and-agent-boundary.md) | Bedrock region and the agent\'s boundaries | Accepted |
