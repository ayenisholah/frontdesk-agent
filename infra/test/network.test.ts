import { Template, Match } from "aws-cdk-lib/assertions";
import { expect, it } from "vitest";
import { createFoundation } from "../src/app";
import { parseInfraConfig } from "../src/config";

it("isolates data, gives application subnets one NAT, and opens only scoped data ports", () => {
  const { network, platform, networking, app } = createFoundation(
    parseInfraConfig({ account: "111111111111", availabilityZones: ["eu-west-1a", "eu-west-1b"] }),
  );
  const template = Template.fromStack(network);
  template.resourceCountIs("AWS::EC2::Subnet", 6);
  template.resourceCountIs("AWS::EC2::NatGateway", 1);
  template.resourceCountIs("AWS::EC2::Route", 4);
  template.hasResourceProperties("AWS::EC2::VPC", { CidrBlock: "10.42.0.0/16" });
  for (const subnet of networking.vpc.isolatedSubnets) {
    const routeTable = network.getLogicalId(
      subnet.node.findChild("RouteTable") as import("aws-cdk-lib").CfnResource,
    );
    expect(
      Object.values(template.findResources("AWS::EC2::Route")).some((r) =>
        JSON.stringify(r).includes(routeTable),
      ),
    ).toBe(false);
  }
  const ingress = Object.values(template.findResources("AWS::EC2::SecurityGroupIngress"));
  expect(ingress).toHaveLength(4);
  template.resourceCountIs("AWS::EC2::SecurityGroup", 4);
  for (const source of [networking.api, networking.worker]) {
    for (const [target, port] of [
      [networking.database, 5432],
      [networking.redis, 6379],
    ] as const) {
      template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
        SourceSecurityGroupId: network.resolve(source.securityGroupId) as unknown,
        GroupId: network.resolve(target.securityGroupId) as unknown,
        IpProtocol: "tcp",
        FromPort: port,
        ToPort: port,
      });
    }
  }
  template.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 30 });
  template.hasResourceProperties("AWS::EC2::FlowLog", {
    TrafficType: "ALL",
    LogDestinationType: "cloud-watch-logs",
  });
  Template.fromStack(platform).hasResourceProperties("AWS::ECS::Cluster", {
    ClusterSettings: [{ Name: "containerInsights", Value: "enabled" }],
  });
  Template.fromStack(platform).resourceCountIs("AWS::ECS::Service", 0);
  expect(network.terminationProtection).toBe(true);
  expect(app.synth().manifest.missing).toBeUndefined();
  template.hasOutput("VpcId", { Value: Match.anyValue() });
}, 20_000);
