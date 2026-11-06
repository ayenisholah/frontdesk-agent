import { Template, Match } from "aws-cdk-lib/assertions";
import { expect, it } from "vitest";
import { createFoundation } from "../src/app";
import { parseInfraConfig } from "../src/config";

it("retains encrypted private data services, generated credentials and seven-day backups", () => {
  const { data, networking, app } = createFoundation(
    parseInfraConfig({ account: "111111111111", availabilityZones: ["eu-west-1a", "eu-west-1b"] }),
  );
  const template = Template.fromStack(data);
  template.hasResource("AWS::RDS::DBInstance", {
    DeletionPolicy: "Retain",
    UpdateReplacePolicy: "Retain",
    Properties: Match.objectLike({
      Engine: "postgres",
      EngineVersion: "16",
      DBInstanceClass: "db.t4g.micro",
      AllocatedStorage: "20",
      StorageType: "gp3",
      PubliclyAccessible: false,
      MultiAZ: false,
      StorageEncrypted: true,
      DeletionProtection: true,
      BackupRetentionPeriod: 7,
      ManageMasterUserPassword: true,
      MasterUserPassword: Match.absent(),
    }),
  });
  template.hasResourceProperties("AWS::RDS::DBParameterGroup", {
    Family: "postgres16",
    Parameters: Match.objectLike({
      "rds.force_ssl": "1",
      log_statement: "none",
      log_min_error_statement: "panic",
      log_parameter_max_length_on_error: "0",
    }),
  });
  template.hasResource("AWS::ElastiCache::ReplicationGroup", {
    DeletionPolicy: "Retain",
    UpdateReplacePolicy: "Retain",
    Properties: Match.objectLike({
      Engine: "redis",
      EngineVersion: "7.1",
      CacheNodeType: "cache.t4g.small",
      NumCacheClusters: 1,
      AutomaticFailoverEnabled: false,
      MultiAZEnabled: false,
      AtRestEncryptionEnabled: true,
      TransitEncryptionEnabled: true,
      TransitEncryptionMode: "required",
      SnapshotRetentionLimit: 7,
      AuthToken: Match.anyValue(),
    }),
  });
  template.hasResourceProperties("AWS::ElastiCache::ParameterGroup", {
    CacheParameterGroupFamily: "redis7",
    Properties: { "maxmemory-policy": "noeviction" },
  });
  template.hasResource("AWS::SecretsManager::Secret", {
    DeletionPolicy: "Retain",
    Properties: Match.objectLike({
      GenerateSecretString: { PasswordLength: 32, ExcludePunctuation: true },
      SecretString: Match.absent(),
      KmsKeyId: Match.anyValue(),
    }),
  });
  template.hasResource("AWS::KMS::Key", {
    DeletionPolicy: "Retain",
    Properties: Match.objectLike({ EnableKeyRotation: true }),
  });
  const rendered = JSON.stringify(template.toJSON());
  expect(rendered).toContain("resolve:secretsmanager:");
  expect(rendered).not.toMatch(/postgresql:\/\/|rediss?:\/\//);
  expect(data.terminationProtection).toBe(true);
  expect(app.synth().manifest.missing).toBeUndefined();
  const isolated = networking.vpc.isolatedSubnets.map((s) => data.resolve(s.subnetId) as unknown);
  template.hasResourceProperties("AWS::RDS::DBSubnetGroup", { SubnetIds: isolated });
  template.hasResourceProperties("AWS::ElastiCache::SubnetGroup", { SubnetIds: isolated });
  template.hasResourceProperties("AWS::RDS::DBInstance", {
    VPCSecurityGroups: [data.resolve(networking.database.securityGroupId) as unknown],
  });
  template.hasResourceProperties("AWS::ElastiCache::ReplicationGroup", {
    SecurityGroupIds: [data.resolve(networking.redis.securityGroupId) as unknown],
  });
  template.hasResourceProperties("AWS::Logs::LogGroup", {
    KmsKeyId: Match.anyValue(),
    RetentionInDays: 30,
  });
  expect(rendered).toContain(":log-group:/aws/rds/instance/frontdesk-pilot-postgres/postgresql");
  template.hasOutput("DatabaseCredentialSecretArn", { Value: Match.anyValue() });
  template.hasOutput("RedisCredentialSecretArn", { Value: Match.anyValue() });
}, 20_000);
