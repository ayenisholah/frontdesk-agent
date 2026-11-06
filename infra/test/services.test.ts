import { Template, Match } from "aws-cdk-lib/assertions";
import { expect, it } from "vitest";
import { createFoundation } from "../src/app";
import { parseInfraConfig } from "../src/config";
it("prepares private, disabled services with TLS ingress and separated migration credentials", () => {
  const config = parseInfraConfig({
    account: "111111111111",
    availabilityZones: ["eu-west-1a", "eu-west-1b"],
    runtime: {
      hostname: "frontdesk.example.com",
      releaseSha: "a".repeat(40),
      certificateArn:
        "arn:aws:acm:eu-west-1:111111111111:certificate/11111111-1111-1111-1111-111111111111",
    },
  });
  const { runtime, app } = createFoundation(config);
  const template = Template.fromStack(runtime!);
  template.hasParameter("AppReleaseSha", {
    Default: "a".repeat(40),
    AllowedPattern: "^[a-f0-9]{40}$",
  });
  template.hasParameter("MigrationReleaseSha", { Default: "a".repeat(40) });
  expect(template.toJSON().Rules).toHaveProperty("PreparedDatabaseRequired");
  template.resourceCountIs("AWS::ECS::Service", 2);
  template.resourceCountIs("AWS::ECS::TaskDefinition", 3);
  for (const service of Object.values(template.findResources("AWS::ECS::Service"))) {
    expect(service.Properties.DesiredCount).toEqual({ Ref: "ServiceDesiredCount" });
    expect(service.Properties.NetworkConfiguration.AwsvpcConfiguration.AssignPublicIp).toBe(
      "DISABLED",
    );
    expect(service.Properties.DeploymentConfiguration.DeploymentCircuitBreaker).toEqual({
      Enable: true,
      Rollback: true,
    });
  }
  template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
    Protocol: "HTTPS",
    Port: 443,
    Certificates: [{ CertificateArn: config.runtime!.certificateArn }],
  });
  template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
    HealthCheckPath: "/readyz",
  });
  template.hasResourceProperties("AWS::ECS::TaskDefinition", {
    Family: "frontdesk-pilot-api",
    ContainerDefinitions: Match.arrayWith([
      Match.objectLike({
        ReadonlyRootFilesystem: true,
        Environment: Match.arrayWith([{ Name: "WHATSAPP_WEBHOOK_ENABLED", Value: "false" }]),
        Secrets: Match.arrayWith([Match.objectLike({ Name: "DATABASE_PASSWORD" })]),
      }),
    ]),
  });
  const tasks = template.findResources("AWS::ECS::TaskDefinition");
  for (const task of Object.values(tasks)) {
    const serialized = JSON.stringify(task);
    if (task.Properties.Family === "frontdesk-pilot-migrate") {
      expect(serialized).toContain("MasterUserSecretSecretArn");
      expect(serialized).toContain("RUNTIME_DATABASE_PASSWORD");
    } else {
      expect(serialized).not.toContain("MasterUserSecretSecretArn");
      expect(serialized).not.toContain("RUNTIME_DATABASE_PASSWORD");
      expect(serialized).toContain("RuntimeCredential");
    }
  }
  for (const [id, role] of Object.entries(template.findResources("AWS::IAM::Role"))) {
    if (id.includes("TaskRole")) {
      expect(role.Properties.Policies).toBeUndefined();
      expect(role.Properties.ManagedPolicyArns).toBeUndefined();
    }
  }
  for (const policy of Object.values(template.findResources("AWS::IAM::Policy"))) {
    const statements = policy.Properties.PolicyDocument.Statement as {
      Resource: unknown;
      Action: unknown;
    }[];
    for (const statement of statements)
      if (statement.Resource === "*") expect(statement.Action).toBe("ecr:GetAuthorizationToken");
  }
  template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
    FromPort: 3110,
    ToPort: 3110,
    SourceSecurityGroupId: Match.objectLike({ "Fn::GetAtt": Match.arrayWith(["GroupId"]) }),
  });
  template.hasOutput("ApiEndpoint", { Value: "https://frontdesk.example.com" });
  expect(JSON.stringify(template.toJSON())).not.toContain("bedrock:");
  expect(
    parseInfraConfig({
      ...config,
      runtime: { ...config.runtime, desiredCount: 1, databasePrepared: true },
    }).runtime?.desiredCount,
  ).toBe(1);
  expect(() => parseInfraConfig({ ...config, account: "222222222222" })).toThrow(
    "Invalid infrastructure configuration",
  );
  expect(app.synth().manifest.missing).toBeUndefined();
  expect(() =>
    parseInfraConfig({ ...config, runtime: { ...config.runtime, desiredCount: 1 } }),
  ).toThrow("Invalid infrastructure configuration");
}, 30_000);
