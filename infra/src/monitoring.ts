import {
  aws_elasticloadbalancingv2 as elb,
  CfnOutput,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  aws_cloudwatch as cw,
  aws_cloudwatch_actions as actions,
  aws_sns as sns,
  aws_kms as kms,
  aws_iam as iam,
} from "aws-cdk-lib";
import type { RuntimeContext } from "./runtime-context";
import type { createServices } from "./services";
type Services = ReturnType<typeof createServices>;
export function createMonitoring(stack: Stack, ctx: RuntimeContext, services: Services) {
  const config = ctx.config.monitoring!;
  const topic = notificationTopic(stack, ctx);
  const dashboard = new cw.Dashboard(stack, "Dashboard", {
    dashboardName: `frontdesk-${ctx.config.stage}`,
  });
  const add = alarmFactory(stack, config.actionsEnabled, topic, dashboard);
  runtimeAlarms(ctx, services, add);
  platformAlarms(ctx, services, add, dashboard);
  new CfnOutput(stack, "AlertTopicArn", { value: topic.topicArn });
  new CfnOutput(stack, "DashboardName", { value: dashboard.dashboardName });
}

type Policy = { threshold: number; periods: number; missing: cw.TreatMissingData; less?: boolean };
type Add = (id: string, metric: cw.IMetric, policy: Policy) => void;
function runtimeAlarms(ctx: RuntimeContext, services: Services, add: Add) {
  const config = ctx.config.monitoring!;
  for (const [name, service] of [
    ["api", services.apiService],
    ["worker", services.workerService],
  ] as const) {
    const metric = (metricName: string, minutes: number, statistic: string) =>
      new cw.Metric({
        namespace: "Frontdesk/Runtime",
        metricName,
        dimensionsMap: { Stage: ctx.config.stage, Service: name },
        period: Duration.minutes(minutes),
        statistic,
      });
    for (const signal of ["Heartbeat", "Ready"])
      add(name + signal, metric(signal, 1, "Maximum"), {
        threshold: 1,
        periods: config.heartbeatMinutes,
        missing: cw.TreatMissingData.BREACHING,
        less: true,
      });
    add(name + "Cpu", service.metricCpuUtilization({ period: Duration.minutes(5) }), {
      threshold: config.utilizationPercent,
      periods: 3,
      missing: cw.TreatMissingData.MISSING,
    });
    add(name + "Memory", service.metricMemoryUtilization({ period: Duration.minutes(5) }), {
      threshold: config.utilizationPercent,
      periods: 3,
      missing: cw.TreatMissingData.MISSING,
    });
    if (name === "worker")
      for (const signal of ["dispatch_failed", "queue_failed", "retention_failed"])
        add(signal, metric(signal, 5, "Sum"), {
          threshold: 1,
          periods: 1,
          missing: cw.TreatMissingData.NOT_BREACHING,
        });
  }
}

function notificationTopic(stack: Stack, ctx: RuntimeContext) {
  const key = new kms.Key(stack, "AlertKey", {
    enableKeyRotation: true,
    removalPolicy: RemovalPolicy.RETAIN,
  });
  key.addToResourcePolicy(
    new iam.PolicyStatement({
      principals: [new iam.ServicePrincipal("cloudwatch.amazonaws.com")],
      actions: ["kms:Decrypt", "kms:GenerateDataKey*"],
      resources: ["*"],
      conditions: {
        StringEquals: { "aws:SourceAccount": ctx.config.account },
        ArnLike: {
          "aws:SourceArn": `arn:aws:cloudwatch:${ctx.config.region}:${ctx.config.account}:alarm:*`,
        },
      },
    }),
  );
  const topic = new sns.Topic(stack, "Alerts", { masterKey: key });
  topic.addToResourcePolicy(
    new iam.PolicyStatement({
      principals: [new iam.ServicePrincipal("cloudwatch.amazonaws.com")],
      actions: ["sns:Publish"],
      resources: [topic.topicArn],
      conditions: { StringEquals: { "aws:SourceAccount": ctx.config.account } },
    }),
  );
  return topic;
}

function alarmFactory(stack: Stack, enabled: boolean, topic: sns.Topic, dashboard: cw.Dashboard) {
  const add: Add = (id, metric, { threshold, periods, missing, less = false }) => {
    const alarm = new cw.Alarm(stack, id, {
      metric,
      threshold,
      evaluationPeriods: periods,
      datapointsToAlarm: periods,
      treatMissingData: missing,
      actionsEnabled: enabled,
      comparisonOperator: less
        ? cw.ComparisonOperator.LESS_THAN_THRESHOLD
        : cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
    alarm.addAlarmAction(new actions.SnsAction(topic));
    alarm.addOkAction(new actions.SnsAction(topic));
    dashboard.addWidgets(new cw.GraphWidget({ title: id, left: [metric], width: 12 }));
  };
  return add;
}

function platformAlarms(
  ctx: RuntimeContext,
  services: Services,
  add: Add,
  dashboard: cw.Dashboard,
) {
  const config = ctx.config.monitoring!;
  add(
    "AlbErrors",
    services.loadBalancer.metrics.httpCodeElb(elb.HttpCodeElb.ELB_5XX_COUNT, {
      period: Duration.minutes(5),
      statistic: "Sum",
    }),
    { threshold: config.errorCount, periods: 1, missing: cw.TreatMissingData.NOT_BREACHING },
  );
  add(
    "TargetErrors",
    services.targetGroup.metrics.httpCodeTarget(elb.HttpCodeTarget.TARGET_5XX_COUNT, {
      period: Duration.minutes(5),
      statistic: "Sum",
    }),
    { threshold: config.errorCount, periods: 1, missing: cw.TreatMissingData.NOT_BREACHING },
  );
  add(
    "DatabaseStorage",
    new cw.Metric({
      namespace: "AWS/RDS",
      metricName: "FreeStorageSpace",
      dimensionsMap: { DBInstanceIdentifier: ctx.data.database.ref },
      period: Duration.minutes(5),
      statistic: "Minimum",
    }),
    {
      threshold: (20 * 1024 ** 3 * config.freeStoragePercent) / 100,
      periods: 3,
      missing: cw.TreatMissingData.MISSING,
      less: true,
    },
  );
  redisDashboard(ctx, dashboard);
}

function redisDashboard(ctx: RuntimeContext, dashboard: cw.Dashboard) {
  const dimensionsMap = {
    CacheClusterId: Fn.join("", [ctx.data.cache.ref, "-001"]),
    CacheNodeId: "0001",
  };
  dashboard.addWidgets(
    new cw.GraphWidget({
      title: "Redis",
      left: ["DatabaseMemoryUsagePercentage", "Evictions", "CurrConnections"].map(
        (metricName) =>
          new cw.Metric({
            namespace: "AWS/ElastiCache",
            metricName,
            dimensionsMap,
            period: Duration.minutes(5),
          }),
      ),
    }),
  );
}
