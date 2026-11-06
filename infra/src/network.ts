import { CfnOutput, RemovalPolicy, Stack, aws_ec2 as ec2, aws_logs as logs } from "aws-cdk-lib";
import type { InfraConfig } from "./config";

export function createNetwork(stack: Stack, config: InfraConfig) {
  const vpc = new ec2.Vpc(stack, "Vpc", {
    ipAddresses: ec2.IpAddresses.cidr(config.cidr),
    availabilityZones: config.availabilityZones,
    natGateways: 1,
    subnetConfiguration: [
      { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
      { name: "application", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      { name: "data", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
    ],
  });
  const logGroup = new logs.LogGroup(stack, "FlowLogGroup", {
    retention: logs.RetentionDays.ONE_MONTH,
    removalPolicy: RemovalPolicy.RETAIN,
  });
  vpc.addFlowLog("FlowLogs", {
    destination: ec2.FlowLogDestination.toCloudWatchLogs(logGroup),
    trafficType: ec2.FlowLogTrafficType.ALL,
  });
  const groups = createGroups(stack, vpc);
  new CfnOutput(stack, "VpcId", { value: vpc.vpcId });
  new CfnOutput(stack, "ApplicationSubnetIds", {
    value: vpc.privateSubnets.map((s) => s.subnetId).join(","),
  });
  new CfnOutput(stack, "DataSubnetIds", {
    value: vpc.isolatedSubnets.map((s) => s.subnetId).join(","),
  });
  for (const [name, group] of Object.entries(groups))
    new CfnOutput(stack, `${name}SecurityGroupId`, { value: group.securityGroupId });
  return { vpc, ...groups };
}
function createGroups(stack: Stack, vpc: ec2.Vpc) {
  const group = (name: string) =>
    new ec2.SecurityGroup(stack, name, { vpc, allowAllOutbound: false, disableInlineRules: true });
  const api = group("Api");
  const worker = group("Worker");
  const database = group("Database");
  const redis = group("Redis");
  for (const app of [api, worker]) {
    app.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "Provider and AWS HTTPS");
    for (const [data, port] of [
      [database, 5432],
      [redis, 6379],
    ] as const) {
      data.addIngressRule(app, ec2.Port.tcp(port));
      app.addEgressRule(data, ec2.Port.tcp(port));
    }
  }
  return { api, worker, database, redis };
}
