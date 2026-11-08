import { Template, Match } from "aws-cdk-lib/assertions";
import { expect, it } from "vitest";
import { createFoundation } from "../src/app";
import { parseInfraConfig } from "../src/config";
import { readFileSync } from "node:fs";
const config = parseInfraConfig(
  JSON.parse(readFileSync("infra/config/runtime.example.json", "utf8")),
);
it("prepares encrypted notifications and explicit pilot alarm policies without enabling actions", () => {
  const settings = parseInfraConfig({ ...config, monitoring: {} });
  const foundation = createFoundation(settings);
  const template = Template.fromStack(foundation.monitoring!);
  template.resourceCountIs("AWS::CloudWatch::Alarm", 14);
  template.resourceCountIs("AWS::CloudWatch::Dashboard", 1);
  template.resourceCountIs("AWS::SNS::Subscription", 0);
  const alarms = Object.values(template.findResources("AWS::CloudWatch::Alarm"));
  assertDisabled(alarms);
  const violation = structuredClone(alarms);
  violation[0]!.Properties.ActionsEnabled = true;
  expect(() => assertDisabled(violation)).toThrow();
  template.hasResourceProperties("AWS::CloudWatch::Alarm", {
    MetricName: "Heartbeat",
    Threshold: 1,
    Period: 60,
    EvaluationPeriods: 3,
    Statistic: "Maximum",
    TreatMissingData: "breaching",
  });
  template.hasResourceProperties("AWS::CloudWatch::Alarm", {
    MetricName: "HTTPCode_ELB_5XX_Count",
    Threshold: 5,
    Period: 300,
    EvaluationPeriods: 1,
    Statistic: "Sum",
  });
  template.hasResourceProperties("AWS::CloudWatch::Alarm", {
    MetricName: "FreeStorageSpace",
    Threshold: 4294967296,
    EvaluationPeriods: 3,
    TreatMissingData: "missing",
  });
  expect(alarms.filter((a) => a.Properties.TreatMissingData === "breaching")).toHaveLength(4);
  template.hasResourceProperties("AWS::SNS::Topic", { KmsMasterKeyId: Match.anyValue() });
  expect(foundation.app.synth().manifest.missing).toBeUndefined();
}, 30_000);
it("rejects monitoring without runtime and validates threshold overrides", () => {
  expect(() => parseInfraConfig({ ...config, runtime: undefined, monitoring: {} })).toThrow();
  expect(() => parseInfraConfig({ ...config, monitoring: { utilizationPercent: 101 } })).toThrow();
  const settings = parseInfraConfig({
    ...config,
    monitoring: { actionsEnabled: true, utilizationPercent: 90 },
  });
  expect(settings.monitoring?.utilizationPercent).toBe(90);
});

function assertDisabled(alarms: unknown[]) {
  for (const alarm of alarms)
    expect(alarm).toMatchObject({ Properties: { ActionsEnabled: false } });
}
