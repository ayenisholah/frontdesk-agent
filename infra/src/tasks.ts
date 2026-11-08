import {
  Duration,
  RemovalPolicy,
  Validations,
  aws_ecs as ecs,
  aws_iam as iam,
  aws_logs as logs,
  aws_secretsmanager as secrets,
  aws_ecr as ecr,
  aws_kms as kms,
} from "aws-cdk-lib";
import type { RuntimeContext } from "./runtime-context";
type Options = {
  name: "api" | "worker" | "migrate";
  releaseSha: string;
  repository: ecr.IRepository;
  credential: secrets.ISecret;
  runtimeCredential: secrets.ISecret;
};
export function createTask(ctx: RuntimeContext, options: Options) {
  const { stack, config } = ctx;
  const { name, repository, credential } = options;
  const principal = new iam.ServicePrincipal("ecs-tasks.amazonaws.com", {
    conditions: {
      StringEquals: { "aws:SourceAccount": config.account },
      ArnLike: { "aws:SourceArn": `arn:aws:ecs:${config.region}:${config.account}:*` },
    },
  });
  const role = new iam.Role(stack, `${name}TaskRole`, { assumedBy: principal });
  const execution = new iam.Role(stack, `${name}ExecutionRole`, { assumedBy: principal });
  const task = new ecs.FargateTaskDefinition(stack, `${name}Task`, {
    family: `frontdesk-${config.stage}-${name}`,
    cpu: 512,
    memoryLimitMiB: 1024,
    taskRole: role,
    executionRole: execution,
  });
  const group = new logs.LogGroup(stack, `${name}Logs`, {
    retention: logs.RetentionDays.ONE_MONTH,
    removalPolicy: RemovalPolicy.RETAIN,
  });
  const databaseSecret = importCredential(ctx, name + "Database", credential);
  const port = name === "api" ? 3110 : 3111;
  const container = task.addContainer(name, {
    image: ecs.ContainerImage.fromEcrRepository(repository, options.releaseSha),
    user: "node",
    readonlyRootFilesystem: name !== "migrate",
    stopTimeout: Duration.seconds(60),
    logging: ecs.LogDrivers.awsLogs({ streamPrefix: name, logGroup: group }),
    environment: environment(ctx, name, options.releaseSha),
    ...containerSettings(ctx, options, databaseSecret, port),
  });
  if (name !== "migrate") container.addPortMappings({ containerPort: port });
  Validations.of(execution.node.findChild("DefaultPolicy")).acknowledge({
    id: "AwsSolutions-IAM5[Resource::*]",
    reason:
      "ECR authorization tokens require Resource *. Image pull, log writes and injected secrets are scoped by CDK grants to this task's repositories, log group and secrets.",
  });
  Validations.of(task).acknowledge({
    id: "AwsSolutions-ECS2",
    reason:
      "Direct environment values are non-secret endpoints, release identifiers and disabled feature flags. Credentials use Secrets Manager injections.",
  });
  return { task, container };
}
function environment({ config, data }: RuntimeContext, name: Options["name"], releaseSha: string) {
  return {
    CLOUD_RUNTIME: "true",
    TELEMETRY_ENABLED: String(Boolean(config.monitoring) && name !== "migrate"),
    TELEMETRY_STAGE: config.stage,
    NODE_ENV: "production",
    AWS_REGION: config.region,
    NODE_EXTRA_CA_CERTS: "/app/certs/rds-eu-west-1.crt",
    DATABASE_HOST: data.database.attrEndpointAddress,
    DATABASE_NAME: "frontdesk",
    REDIS_HOST: data.cache.attrPrimaryEndPointAddress,
    RELEASE_SHA: releaseSha,
    QUEUE_PREFIX: `frontdesk-${config.stage}`,
    TRUST_PROXY: "alb",
    PORT: "3110",
    WORKER_PORT: "3111",
    WHATSAPP_WEBHOOK_ENABLED: "false",
    INBOUND_WORKER_ENABLED: "false",
    OUTBOUND_WORKER_ENABLED: "false",
    CONTENT_RETENTION_ENABLED: name === "worker" ? "true" : "false",
  };
}

function importCredential(ctx: RuntimeContext, id: string, secret: secrets.ISecret) {
  return secrets.Secret.fromSecretAttributes(ctx.stack, id, {
    secretCompleteArn: secret.secretArn,
    encryptionKey: kms.Key.fromKeyArn(ctx.stack, id + "Key", ctx.data.key.keyArn),
  });
}

function containerSettings(
  ctx: RuntimeContext,
  options: Options,
  databaseSecret: secrets.ISecret,
  port: number,
) {
  const { name, runtimeCredential } = options;
  const { data } = ctx;
  return {
    secrets: {
      DATABASE_USER: ecs.Secret.fromSecretsManager(databaseSecret, "username"),
      DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(databaseSecret, "password"),
      REDIS_PASSWORD: ecs.Secret.fromSecretsManager(
        importCredential(ctx, name + "Redis", data.credential),
      ),
      ...(name === "migrate"
        ? {
            RUNTIME_DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(
              importCredential(ctx, name + "Runtime", runtimeCredential),
              "password",
            ),
          }
        : {}),
    },
    ...(name === "migrate"
      ? {}
      : {
          healthCheck: {
            command: [
              "CMD-SHELL",
              `node -e "fetch('http://127.0.0.1:${port}/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`,
            ],
            interval: Duration.seconds(30),
            timeout: Duration.seconds(5),
            retries: 3,
            startPeriod: Duration.seconds(60),
          },
        }),
  };
}
