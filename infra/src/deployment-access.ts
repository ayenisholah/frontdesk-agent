import { CfnOutput, Duration, aws_iam as iam } from "aws-cdk-lib";
import type { RuntimeContext } from "./runtime-context";
import type { ReleaseResources } from "./deployment-context";
import { createStack } from "./stack";
import { grantReleaseAccess } from "./deployment-policies";
export function createDeploymentAccess(runtime: RuntimeContext, resources: ReleaseResources) {
  const { config } = runtime;
  const stack = createStack(runtime.stack.node.root, "deployment-access", config);
  const providerArn = config.deployment!.providerArn
    ? config.deployment!.providerArn
    : new iam.OidcProviderNative(stack, "GitHubProvider", {
        url: "https://token.actions.githubusercontent.com",
        clientIds: ["sts.amazonaws.com"],
      }).oidcProviderArn;
  const github = new iam.Role(stack, "GitHubReleaseRole", {
    roleName: `frontdesk-${config.stage}-github-release`,
    maxSessionDuration: Duration.hours(2),
    assumedBy: new iam.FederatedPrincipal(
      providerArn,
      {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub":
            "repo:ayenisholah@49761315/frontdesk-agent@1441751147:environment:production",
        },
      },
      "sts:AssumeRoleWithWebIdentity",
    ),
  });
  const cloudformation = new iam.Role(stack, "CloudFormationReleaseRole", {
    roleName: `frontdesk-${config.stage}-cloudformation-release`,
    assumedBy: new iam.ServicePrincipal("cloudformation.amazonaws.com"),
  });
  grantReleaseAccess({ runtime, resources, stack, github, cloudformation });
  new CfnOutput(stack, "DeploymentRoleArn", { value: github.roleArn });
  new CfnOutput(stack, "CloudFormationReleaseRoleArn", { value: cloudformation.roleArn });
  return stack;
}
