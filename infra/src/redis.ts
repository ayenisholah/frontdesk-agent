import {
  RemovalPolicy,
  Validations,
  aws_elasticache as elasticache,
  aws_secretsmanager as secrets,
} from "aws-cdk-lib";
import type { DataContext } from "./data-context";
export function createRedis({ stack, config, networking, key }: DataContext) {
  const credential = new secrets.Secret(stack, "RedisCredential", {
    encryptionKey: key,
    generateSecretString: { passwordLength: 32, excludePunctuation: true },
    removalPolicy: RemovalPolicy.RETAIN,
  });
  const subnetGroup = new elasticache.CfnSubnetGroup(stack, "RedisSubnets", {
    description: "Isolated pilot Redis subnets",
    subnetIds: networking.vpc.isolatedSubnets.map((s) => s.subnetId),
  });
  const parameters = new elasticache.CfnParameterGroup(stack, "RedisParameters", {
    description: "Durable queue references must not be evicted",
    cacheParameterGroupFamily: "redis7",
    properties: { "maxmemory-policy": "noeviction" },
  });
  const cache = new elasticache.CfnReplicationGroup(stack, "Redis", {
    replicationGroupDescription: "Frontdesk pilot queue transport",
    engine: "redis",
    engineVersion: "7.1",
    cacheNodeType: "cache.t4g.small",
    numCacheClusters: 1,
    automaticFailoverEnabled: false,
    multiAzEnabled: false,
    preferredCacheClusterAZs: [config.availabilityZones[0]],
    cacheSubnetGroupName: subnetGroup.ref,
    cacheParameterGroupName: parameters.ref,
    securityGroupIds: [networking.redis.securityGroupId],
    port: 6379,
    atRestEncryptionEnabled: true,
    kmsKeyId: key.keyArn,
    transitEncryptionEnabled: true,
    transitEncryptionMode: "required",
    authToken: credential.secretValue.unsafeUnwrap(),
    snapshotRetentionLimit: 7,
    autoMinorVersionUpgrade: true,
  });
  cache.applyRemovalPolicy(RemovalPolicy.RETAIN);
  Validations.of(cache).acknowledge(
    {
      id: "AwsSolutions-AEC4",
      reason:
        "Approved single-node pilot; no replica or automatic failover. Postgres is the durable work ledger. ADR 0015.",
    },
    {
      id: "AwsSolutions-AEC5",
      reason:
        "Standard Redis port is accessible only from API/worker security groups; TLS and AUTH are mandatory.",
    },
  );
  Validations.of(credential).acknowledge({
    id: "AwsSolutions-SMG4",
    reason:
      "Redis AUTH rotation must coordinate cache and consumers. No consumers are deployed; coordinated rotation is required before live deployment.",
  });
  return { cache, credential };
}
