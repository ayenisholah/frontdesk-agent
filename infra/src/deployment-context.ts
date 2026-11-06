import type { Stack, aws_ecs as ecs, aws_ecr as ecr, aws_iam as iam } from "aws-cdk-lib";
import type { RuntimeContext } from "./runtime-context";
export type ReleaseResources = {
  api: { task: ecs.FargateTaskDefinition };
  worker: { task: ecs.FargateTaskDefinition };
  migration: { task: ecs.FargateTaskDefinition };
  repository: ecr.Repository;
  apiService: ecs.FargateService;
  workerService: ecs.FargateService;
};
export type AccessContext = {
  runtime: RuntimeContext;
  resources: ReleaseResources;
  stack: Stack;
  github: iam.Role;
  cloudformation: iam.Role;
};
