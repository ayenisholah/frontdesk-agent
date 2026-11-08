# Operational readiness

M4.4 monitoring is prepared in code; no resources, subscriptions or notification
changes have been deployed. Redis rotation and the cost/readiness report remain
planned. M4 remains open until live operational acceptance.

## Monitoring

The optional `monitoring` configuration requires `runtime`. Its default
`actionsEnabled: false` creates alarms without sending notifications. The isolated
monitoring stack owns an encrypted SNS topic and CloudWatch dashboard; the release
role cannot change them. No email address or subscription is committed. Supply and
confirm an email subscription privately during activation, verify telemetry and
a test notification, then enable actions through an infrastructure review.

API and worker emit Embedded Metric Format records through their existing logs
once per minute, immediately on startup. Dimensions are only `Stage` and `Service`.
There are no customer identifiers, message text, credentials or raw errors.
Heartbeat indicates a responsive process, not successful work. Ready tests database
and Redis dependencies with a two-second bound. A stuck probe is not started again
until it settles. Worker failure metrics are interval deltas; a failed output keeps
them for the next attempt. Sampling stops on shutdown and cannot fail message work.
Local telemetry is off unless `TELEMETRY_ENABLED=true` and `TELEMETRY_STAGE=pilot`.

| Signal | Default condition | Missing data |
| --- | --- | --- |
| API/worker heartbeat and readiness | Below 1 for 3 consecutive 1-minute periods | Breaching |
| ALB and target 5xx, separately | At least 5 in 5 minutes | Not breaching |
| ECS CPU and memory | At least 80% for 3 consecutive 5-minute periods | Missing |
| RDS storage | Below 20% of provisioned 20 GiB for 3 consecutive 5-minute periods | Missing |
| Dispatch, queue, retention failures | At least 1 in 5 minutes | Not breaching |

Threshold overrides are validated by the infrastructure configuration. Heartbeat
and Ready use Maximum to avoid false alerts from an old task during a healthy
rolling replacement. Confirm every active task is healthy during release checks.
Alarms are not exact timers: CloudWatch ingestion and evaluation can delay state
changes. Zero-task preparation deliberately has no heartbeat; keep actions disabled.

The dashboard includes Redis memory, evictions and connections using the current
single-node cluster's `-001` member and node `0001`. Verify the member ID and metric
presence before activation or any topology change. RDS storage thresholds must be
reviewed with any storage-size change. Redis dashboard data does not itself page.

## Incident runbooks

Start with account, region, alarm, release SHA and timestamp. Inspect sanitized
service logs and resource health; never paste credentials, SQL, phone numbers or
message bodies into tickets or public artifacts.

- **Missing heartbeat:** check desired/running task counts, stopped-task reasons,
  image pull and log delivery. A log pipeline failure can look like service failure.
  If a release is implicated, follow [release recovery](AWS_DEPLOYMENT.md).
- **Dependency readiness or 5xx:** inspect RDS/Redis availability, connections,
  security groups and secret versions. Check service events and ALB target health.
  Do not restart migrations or rotate credentials as an unexplained first step.
- **CPU/memory/storage:** correlate traffic and connections; investigate before
  resizing. Back up and review infrastructure changes. Never delete tenant data
  or queue keys to silence an alarm.
- **Dispatch/queue failures:** inspect dependency health and durable inbox/outbox
  state. Restore the transport and let Postgres reconciliation rebuild due work;
  avoid manual replay of uncertain outbound attempts.
- **Retention failure:** restore database access and inspect the retention job.
  Run the existing idempotent retention path after recovery; verify expired data
  is redacted without logging its contents.
- **Provider outage:** keep the established retry/handoff and uncertainty rules.
  Do not bypass the WhatsApp window, enable disabled providers or replay tool calls.
- **Planned maintenance:** record alarm states and a bounded maintenance window,
  disable notification actions through the reviewed infrastructure path if needed,
  perform maintenance, verify health, then restore actions. Do not change thresholds
  merely to suppress a real failure. Never overlap maintenance with a release.

These metrics establish infrastructure visibility, not proof of NFR-3's end-to-end
p95 latency or live model quality. Live acceptance must test notification delivery,
failed-release recovery, Redis rotation, database restore, runtime database password
rotation and real-phone behavior before claiming operational readiness.
