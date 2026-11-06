import { App, CfnOutput, Tags, RemovalPolicy, aws_ecr as ecr } from "aws-cdk-lib";
import type { InfraConfig } from "./config";
import { applySecurityChecks } from "./security";
import { createStack } from "./stack";
export function createFoundation(config: InfraConfig) {
  const app = new App({ context: { "@aws-cdk/aws-ec2:restrictDefaultSecurityGroup": true } });
  const platform = createStack(app, "platform", config);
  for (const service of ["api", "worker"]) {
    const repository = new ecr.Repository(platform, `${service}Repository`, {
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      imageScanOnPush: true,
      removalPolicy: RemovalPolicy.RETAIN,
      emptyOnDelete: false,
    });
    new CfnOutput(platform, `${service}RepositoryUri`, { value: repository.repositoryUri });
  }
  Tags.of(app).add("Project", "frontdesk");
  Tags.of(app).add("Stage", config.stage);
  Tags.of(app).add("ManagedBy", "cdk");
  new CfnOutput(platform, "Region", { value: config.region });
  applySecurityChecks(app);
  return { app, platform };
}
