# ADR 0018: Bounded runtime telemetry and prepared operational alarms

Status: Accepted

## Context

The pilot already prepares ECS logs and Container Insights. Worker failures were
visible only through a private metrics endpoint, and no alarms or notifications
were prepared. Live activation remains deferred.

## Decision

Emit low-cardinality CloudWatch Embedded Metric Format records through the existing
log driver. Share bounded sampling between API and worker through the runtime
package. Only stage/service dimensions and numeric operational values are allowed.
Keep source traces in the existing tenant-scoped database; do not export customer
content to monitoring.

Own the dashboard, encrypted SNS topic and alarms in an optional monitoring stack.
Default notification actions to disabled and configure recipients privately at
activation. Application release permissions do not administer this stack.

## Consequences

There is no collector or public metrics endpoint to operate. CloudWatch metrics,
alarms and logs incur usage charges that the cost review must include. Missing
telemetry can indicate either service failure or logging failure. Infrastructure
health is not proof of conversation latency or model quality. The single-node
Redis dashboard member and RDS storage threshold must be revisited if topology or
storage changes. Live alert delivery and operational drills remain acceptance work.
