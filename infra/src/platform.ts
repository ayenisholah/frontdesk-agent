import {
  CfnOutput,
  RemovalPolicy,
  Stack,
  aws_ec2 as ec2,
  aws_ecr as ecr,
  aws_ecs as ecs,
} from "aws-cdk-lib";
export function createPlatform(stack: Stack, vpc: ec2.Vpc) {
  const cluster = new ecs.Cluster(stack, "Cluster", {
    vpc,
    containerInsightsV2: ecs.ContainerInsights.ENABLED,
  });
  new CfnOutput(stack, "ClusterArn", { value: cluster.clusterArn });
  const repositories = ["api", "worker"].map((service) => {
    const repository = new ecr.Repository(stack, `${service}Repository`, {
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      imageScanOnPush: true,
      removalPolicy: RemovalPolicy.RETAIN,
      emptyOnDelete: false,
    });
    new CfnOutput(stack, `${service}RepositoryUri`, { value: repository.repositoryUri });
    return repository;
  });
  return { cluster, api: repositories[0]!, worker: repositories[1]! };
}
