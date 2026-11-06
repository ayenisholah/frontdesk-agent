const sha = "a".repeat(40);
export const config = {
  account: "111111111111",
  region: "eu-west-1" as const,
  stack: "frontdesk-pilot-runtime" as const,
  roleArn: "arn:aws:iam::111111111111:role/frontdesk-pilot-cloudformation-release",
  requestId: "1-1",
};
export function stackResponse() {
  const outputs = {
    ApiRepositoryUri: "111111111111.dkr.ecr.eu-west-1.amazonaws.com/api",
    WorkerRepositoryUri: "111111111111.dkr.ecr.eu-west-1.amazonaws.com/worker",
    MigrationRepositoryUri: "111111111111.dkr.ecr.eu-west-1.amazonaws.com/migrate",
    ClusterArn: "arn:aws:ecs:eu-west-1:111111111111:cluster/pilot",
    MigrationTaskDefinitionArn:
      "arn:aws:ecs:eu-west-1:111111111111:task-definition/frontdesk-pilot-migrate:1",
    ApiTaskDefinitionArn:
      "arn:aws:ecs:eu-west-1:111111111111:task-definition/frontdesk-pilot-api:1",
    WorkerTaskDefinitionArn:
      "arn:aws:ecs:eu-west-1:111111111111:task-definition/frontdesk-pilot-worker:1",
    ApplicationSubnetIds: "subnet-123,subnet-456",
    MigrationSecurityGroupId: "sg-123",
    ApiServiceName: "api",
    WorkerServiceName: "worker",
    ApiEndpoint: "https://frontdesk.example.com",
    TargetGroupArn: "arn:aws:elasticloadbalancing:eu-west-1:111111111111:targetgroup/api/123",
  };
  return {
    Stacks: [
      {
        StackStatus: "UPDATE_COMPLETE",
        Parameters: Object.entries({
          AppReleaseSha: sha,
          MigrationReleaseSha: sha,
          ServiceDesiredCount: "0",
          DatabasePrepared: "false",
        }).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })),
        Outputs: Object.entries(outputs).map(([OutputKey, OutputValue]) => ({
          OutputKey,
          OutputValue,
        })),
      },
    ],
  };
}
