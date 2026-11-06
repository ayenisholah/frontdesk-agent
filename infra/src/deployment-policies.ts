import { Validations, aws_iam as iam } from "aws-cdk-lib";
import type { AccessContext } from "./deployment-context";
export function grantReleaseAccess(ctx: AccessContext) {
  const { runtime, resources, github, cloudformation } = ctx;
  for (const repo of [runtime.platform.api, runtime.platform.worker, resources.repository]) {
    repo.grantPullPush(github);
    github.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ecr:DescribeImages", "ecr:DescribeRepositories"],
        resources: [repo.repositoryArn],
      }),
    );
  }
  github.addToPolicy(
    new iam.PolicyStatement({
      actions: ["cloudformation:DescribeStacks"],
      resources: [runtime.stack.stackId],
    }),
  );
  github.addToPolicy(
    new iam.PolicyStatement({
      actions: ["cloudformation:UpdateStack"],
      resources: [runtime.stack.stackId],
      conditions: { StringEquals: { "cloudformation:RoleArn": cloudformation.roleArn } },
    }),
  );
  github.addToPolicy(
    new iam.PolicyStatement({
      actions: ["iam:PassRole"],
      resources: [cloudformation.roleArn],
      conditions: { StringEquals: { "iam:PassedToService": "cloudformation.amazonaws.com" } },
    }),
  );
  grantServices(ctx);
  const prefix = `arn:aws:ecs:${runtime.config.region}:${runtime.config.account}`;
  const families = ["api", "worker", "migrate"].map(
    (name) => `${prefix}:task-definition/frontdesk-${runtime.config.stage}-${name}:*`,
  );
  cloudformation.addToPolicy(
    new iam.PolicyStatement({
      actions: [
        "ecs:RegisterTaskDefinition",
        "ecs:DescribeTaskDefinition",
        "ecs:DeregisterTaskDefinition",
        "ecs:TagResource",
        "ecs:ListTagsForResource",
      ],
      resources: families,
    }),
  );
  grantTaskRoles(ctx);
  grantTaskOperations(ctx, families[2]!);
  acknowledgeRevisions(ctx, families, prefix);
}
function passTaskRole(role: iam.Role, arn: string) {
  role.addToPolicy(
    new iam.PolicyStatement({
      actions: ["iam:PassRole"],
      resources: [arn],
      conditions: { StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" } },
    }),
  );
}
function grantTaskOperations({ runtime, github }: AccessContext, family: string) {
  const cluster = runtime.platform.cluster;
  const condition = { ArnEquals: { "ecs:cluster": cluster.clusterArn } };
  github.addToPolicy(
    new iam.PolicyStatement({
      actions: ["ecs:RunTask"],
      resources: [family],
      conditions: condition,
    }),
  );
  github.addToPolicy(
    new iam.PolicyStatement({
      actions: ["ecs:DescribeTasks", "ecs:StopTask"],
      resources: [`arn:aws:ecs:${runtime.config.region}:${runtime.config.account}:task/*`],
      conditions: condition,
    }),
  );
  github.addToPolicy(
    new iam.PolicyStatement({
      actions: ["ecs:ListTasks"],
      resources: ["*"],
      conditions: condition,
    }),
  );
  github.addToPolicy(
    new iam.PolicyStatement({
      actions: ["elasticloadbalancing:DescribeTargetHealth"],
      resources: ["*"],
    }),
  );
  // A migration launch has no user-supplied tags or overrides; application services are updated by CloudFormation only.
}

function grantTaskRoles({ resources, cloudformation, github }: AccessContext) {
  for (const task of [resources.api.task, resources.worker.task, resources.migration.task]) {
    passTaskRole(cloudformation, task.taskRole.roleArn);
    passTaskRole(cloudformation, task.executionRole!.roleArn);
  }
  passTaskRole(github, resources.migration.task.taskRole.roleArn);
  passTaskRole(github, resources.migration.task.executionRole!.roleArn);
}

function acknowledgeRevisions(
  { github, cloudformation }: AccessContext,
  families: string[],
  prefix: string,
) {
  for (const [role, allowed] of [
    [github, ["*", families[2]!, `${prefix}:task/*`]],
    [cloudformation, families],
  ] as const)
    for (const resource of allowed)
      Validations.of(role.node.findChild("DefaultPolicy")).acknowledge({
        id: `AwsSolutions-IAM5[Resource::${resource}]`,
        reason:
          "Exact pilot task families require revision suffixes; task operations also require the exact cluster condition. Global resource access is limited to ECR authorization, ALB health reads and cluster-constrained ListTasks.",
      });
}

function grantServices({ resources, github, cloudformation }: AccessContext) {
  const services = [resources.apiService.serviceArn, resources.workerService.serviceArn];
  github.addToPolicy(
    new iam.PolicyStatement({ actions: ["ecs:DescribeServices"], resources: services }),
  );
  cloudformation.addToPolicy(
    new iam.PolicyStatement({
      actions: ["ecs:DescribeServices", "ecs:UpdateService"],
      resources: services,
    }),
  );
}
