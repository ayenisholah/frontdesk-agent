import { CfnOutput, RemovalPolicy, Stack, aws_kms as kms } from "aws-cdk-lib";
import type { InfraConfig } from "./config";
import type { DataContext } from "./data-context";
import { createPostgres } from "./postgres";
import { createRedis } from "./redis";
export function createDataServices(
  stack: Stack,
  networking: DataContext["networking"],
  config: InfraConfig,
) {
  const key = new kms.Key(stack, "DataKey", {
    enableKeyRotation: true,
    removalPolicy: RemovalPolicy.RETAIN,
  });
  const context = { stack, networking, config, key };
  const database = createPostgres(context);
  const { cache, credential } = createRedis(context);
  const outputs = {
    DataKeyArn: key.keyArn,
    DatabaseEndpoint: database.attrEndpointAddress,
    DatabasePort: database.attrEndpointPort,
    DatabaseCredentialSecretArn: database.attrMasterUserSecretSecretArn,
    RedisEndpoint: cache.attrPrimaryEndPointAddress,
    RedisPort: cache.attrPrimaryEndPointPort,
    RedisCredentialSecretArn: credential.secretArn,
  };
  for (const [name, value] of Object.entries(outputs)) new CfnOutput(stack, name, { value });
}
