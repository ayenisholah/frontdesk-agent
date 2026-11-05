# 0002: ECS Fargate, RDS Postgres and ElastiCache on AWS

**Status:** Accepted

## Context

The first release ran on one server with Docker Compose. That gives no managed failover or backups, and it doesn't meet the production goals. The design depends on long-running BullMQ workers, per-conversation ordering and delayed reminder jobs.

## Decision

Run the API, worker and dashboard as ECS Fargate services behind an Application Load Balancer, with RDS Postgres and ElastiCache for Redis. Secrets live in Secrets Manager.

Lambda with SQS was rejected because it would replace BullMQ and force a redesign of ordering, reminders and retries. A single EC2 instance was rejected because backups and failover would remain our job.

## Consequences

- The BullMQ design in the SPEC stands, and the containers we already build carry over.
- Fixed monthly cost is higher than the alternatives. The M4 cost report must state it before cutover.
- ElastiCache must keep BullMQ's requirements: `noeviction` and persistence settings suited to delayed jobs.
- `trust proxy` in `apps/api/src/app.ts` is `loopback` today and must change behind the ALB, or client IPs and protocol will be wrong.
- The AWS region is decided in M4, after checking Bedrock model availability there.
