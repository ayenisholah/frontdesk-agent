import {
  ArnFormat,
  RemovalPolicy,
  Validations,
  aws_rds as rds,
  aws_logs as logs,
  aws_iam as iam,
} from "aws-cdk-lib";
import type { DataContext } from "./data-context";
export function createPostgres(context: DataContext) {
  const { stack, config, networking, key } = context;
  const subnetGroup = new rds.CfnDBSubnetGroup(stack, "DatabaseSubnets", {
    dbSubnetGroupDescription: "Isolated pilot database subnets",
    subnetIds: networking.vpc.isolatedSubnets.map((s) => s.subnetId),
  });
  const parameters = databaseParameters(context);
  const identifier = `frontdesk-${config.stage}-postgres`;
  const logGroup = databaseLogs(context, identifier);
  const database = new rds.CfnDBInstance(stack, "Postgres", {
    dbInstanceIdentifier: identifier,
    dbName: "frontdesk",
    engine: "postgres",
    engineVersion: "16",
    dbInstanceClass: "db.t4g.micro",
    allocatedStorage: "20",
    storageType: "gp3",
    availabilityZone: config.availabilityZones[0],
    multiAz: false,
    publiclyAccessible: false,
    storageEncrypted: true,
    kmsKeyId: key.keyArn,
    deletionProtection: true,
    backupRetentionPeriod: 7,
    copyTagsToSnapshot: true,
    autoMinorVersionUpgrade: true,
    engineLifecycleSupport: "open-source-rds-extended-support-disabled",
    masterUsername: "frontdesk_owner",
    manageMasterUserPassword: true,
    masterUserSecret: { kmsKeyId: key.keyArn },
    port: "5432",
    dbSubnetGroupName: subnetGroup.ref,
    dbParameterGroupName: parameters.ref,
    vpcSecurityGroups: [networking.database.securityGroupId],
    enableCloudwatchLogsExports: ["postgresql"],
  });
  database.applyRemovalPolicy(RemovalPolicy.RETAIN);
  database.node.addDependency(logGroup);
  Validations.of(database).acknowledge(
    {
      id: "CloudFormation-Validate::W3010",
      reason:
        "The availability zone is supplied by validated pilot configuration; offline synthesis does not query account zones.",
    },
    {
      id: "AwsSolutions-RDS3",
      reason: "Approved single-AZ pilot baseline; automatic failover is deferred. ADR 0015.",
    },
    {
      id: "AwsSolutions-RDS11",
      reason:
        "Standard Postgres port is reachable only from API/worker security groups, with TLS required.",
    },
  );
  return database;
}
function databaseLogs({ stack, config, key }: DataContext, identifier: string) {
  const logGroupName = `/aws/rds/instance/${identifier}/postgresql`;
  key.addToResourcePolicy(
    new iam.PolicyStatement({
      principals: [new iam.ServicePrincipal(`logs.${config.region}.amazonaws.com`)],
      actions: [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:ReEncrypt*",
        "kms:GenerateDataKey*",
        "kms:DescribeKey",
      ],
      resources: ["*"],
      conditions: {
        ArnEquals: {
          "kms:EncryptionContext:aws:logs:arn": stack.formatArn({
            service: "logs",
            resource: "log-group",
            resourceName: logGroupName,
            arnFormat: ArnFormat.COLON_RESOURCE_NAME,
          }),
        },
      },
    }),
  );
  return new logs.LogGroup(stack, "DatabaseLogs", {
    logGroupName,
    encryptionKey: key,
    retention: logs.RetentionDays.ONE_MONTH,
    removalPolicy: RemovalPolicy.RETAIN,
  });
}

function databaseParameters({ stack }: DataContext) {
  return new rds.CfnDBParameterGroup(stack, "DatabaseParameters", {
    description: "Require TLS and exclude SQL payloads from logs",
    family: "postgres16",
    parameters: {
      "rds.force_ssl": "1",
      log_statement: "none",
      log_min_duration_statement: "-1",
      log_min_error_statement: "panic",
      log_parameter_max_length: "0",
      log_parameter_max_length_on_error: "0",
      log_error_verbosity: "terse",
      log_min_messages: "fatal",
      log_connections: "0",
      log_disconnections: "0",
    },
  });
}
