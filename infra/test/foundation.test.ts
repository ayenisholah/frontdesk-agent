import { App, Stack, aws_ec2 as ec2 } from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { expect, it } from "vitest";
import { parseInfraConfig } from "../src/config";
import { createFoundation } from "../src/app";
import { applySecurityChecks } from "../src/security";

const fixture = { account: "111111111111", availabilityZones: ["eu-west-1a", "eu-west-1b"] };
it("validates pilot configuration and never echoes invalid input", () => {
  expect(parseInfraConfig(fixture)).toMatchObject({
    stage: "pilot",
    region: "eu-west-1",
    cidr: "10.42.0.0/16",
  });
  for (const input of [
    {},
    { ...fixture, account: "secret" },
    { ...fixture, region: "us-east-1" },
    { ...fixture, cidr: "0.0.0.0/0" },
    { ...fixture, availabilityZones: ["eu-west-1a", "eu-west-1a"] },
    { ...fixture, availabilityZones: ["eu-west-1a", "eu-north-1b"] },
    { ...fixture, extra: "secret" },
  ])
    expect(() => parseInfraConfig(input)).toThrow("Invalid infrastructure configuration");
});
it("synthesizes protected stacks without lookups or credentials", () => {
  const { app, platform } = createFoundation(parseInfraConfig(fixture));
  expect(platform.terminationProtection).toBe(true);
  Template.fromStack(platform).hasOutput("Region", { Value: "eu-west-1" });
  Template.fromStack(platform).resourceCountIs("AWS::ECR::Repository", 2);
  Template.fromStack(platform).hasResource("AWS::ECR::Repository", {
    DeletionPolicy: "Retain",
    UpdateReplacePolicy: "Retain",
    Properties: Match.objectLike({
      ImageTagMutability: "IMMUTABLE",
      ImageScanningConfiguration: { ScanOnPush: true },
    }),
  });
  expect(app.synth().manifest.missing).toBeUndefined();
  Annotations.fromStack(platform).hasNoError("*", Match.anyValue());
});
it("rejects a planted unrestricted database ingress rule", () => {
  const app = new App();
  const stack = new Stack(app, "Violation");
  const vpc = new ec2.CfnVPC(stack, "Vpc", { cidrBlock: "10.0.0.0/16" });
  new ec2.CfnSecurityGroup(stack, "Unsafe", {
    groupDescription: "Planted violation",
    vpcId: vpc.ref,
    securityGroupIngress: [
      { ipProtocol: "tcp", fromPort: 5432, toPort: 5432, cidrIp: "0.0.0.0/0" },
    ],
  });
  const report = applySecurityChecks(app).validateScope(app);
  expect(report.violations).toEqual(
    expect.arrayContaining([expect.objectContaining({ ruleName: "AwsSolutions-EC23" })]),
  );
});
