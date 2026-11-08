import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Validations,
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_ecr as ecr,
  aws_secretsmanager as secrets,
  aws_elasticloadbalancingv2 as elb,
  aws_certificatemanager as acm,
} from "aws-cdk-lib";
import type { RuntimeContext } from "./runtime-context";
import { createRuntimeCredential } from "./runtime-secrets";
import { createReleaseParameters } from "./release-parameters";
import { createTask } from "./tasks";
export function createServices(ctx: RuntimeContext) {
  const { platform } = ctx;
  const release = createReleaseParameters(ctx);
  const credential = createRuntimeCredential(ctx);
  const admin = administrator(ctx);
  const api = createTask(ctx, {
    name: "api",
    releaseSha: release.app,
    repository: platform.api,
    credential,
    runtimeCredential: credential,
  });
  const worker = createTask(ctx, {
    name: "worker",
    releaseSha: release.app,
    repository: platform.worker,
    credential,
    runtimeCredential: credential,
  });
  const repository = migrationRepository(ctx);
  const migration = createTask(ctx, {
    name: "migrate",
    releaseSha: release.migration,
    repository,
    credential: admin,
    runtimeCredential: credential,
  });
  const apiService = service(ctx, "ApiService", {
    taskDefinition: api.task,
    group: ctx.network.api,
    desiredCount: release.desiredCount,
  });
  const workerService = service(ctx, "WorkerService", {
    taskDefinition: worker.task,
    group: ctx.network.worker,
    desiredCount: release.desiredCount,
  });
  const { targetGroup, loadBalancer } = addIngress(ctx, apiService);
  serviceOutputs(ctx, { migration, repository, credential, release, api, worker, targetGroup });
  return {
    api,
    worker,
    migration,
    repository,
    apiService,
    workerService,
    targetGroup,
    loadBalancer,
  };
}
function service(
  ctx: RuntimeContext,
  id: string,
  {
    taskDefinition,
    group,
    desiredCount,
  }: { taskDefinition: ecs.FargateTaskDefinition; group: ec2.SecurityGroup; desiredCount: number },
) {
  const result = new ecs.FargateService(ctx.stack, id, {
    cluster: ctx.platform.cluster,
    taskDefinition,
    desiredCount,
    assignPublicIp: false,
    vpcSubnets: { subnets: ctx.network.vpc.privateSubnets },
    securityGroups: [
      ec2.SecurityGroup.fromSecurityGroupId(ctx.stack, `${id}Group`, group.securityGroupId, {
        mutable: false,
      }),
    ],
    circuitBreaker: { rollback: true },
    minHealthyPercent: 100,
    maxHealthyPercent: 200,
    enableExecuteCommand: false,
  });
  new CfnOutput(ctx.stack, `${id}Name`, { value: result.serviceName });
  return result;
}
function addIngress(ctx: RuntimeContext, api: ecs.FargateService) {
  const { stack, network, settings } = ctx;
  const group = new ec2.SecurityGroup(stack, "LoadBalancerSecurityGroup", {
    vpc: network.vpc,
    allowAllOutbound: false,
  });
  Validations.of(group).acknowledge({
    id: "AwsSolutions-EC23",
    reason:
      "Public HTTPS ingress is required for webhooks. Only port 443 reaches the ALB; application tasks and data remain private.",
  });
  group.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS only");
  group.addEgressRule(network.api, ec2.Port.tcp(3110));
  network.api.addIngressRule(group, ec2.Port.tcp(3110), "ALB only", true);
  const loadBalancer = new elb.ApplicationLoadBalancer(stack, "LoadBalancer", {
    vpc: network.vpc,
    internetFacing: true,
    securityGroup: group,
    deletionProtection: true,
    dropInvalidHeaderFields: true,
    vpcSubnets: { subnets: network.vpc.publicSubnets },
  });
  const targetGroup = loadBalancer
    .addListener("Https", {
      port: 443,
      open: false,
      certificates: [
        acm.Certificate.fromCertificateArn(stack, "Certificate", settings.certificateArn),
      ],
      sslPolicy: elb.SslPolicy.RECOMMENDED_TLS,
    })
    .addTargets("Api", {
      port: 3110,
      protocol: elb.ApplicationProtocol.HTTP,
      targets: [api],
      healthCheck: { path: "/readyz", healthyHttpCodes: "200" },
      deregistrationDelay: Duration.seconds(30),
    });
  Validations.of(loadBalancer).acknowledge({
    id: "AwsSolutions-ELB2",
    reason:
      "ALB access logs include unredactable verification-token query strings. Application logs record sanitized route labels only; raw URL logging stays disabled.",
  });
  new CfnOutput(stack, "LoadBalancerDnsName", { value: loadBalancer.loadBalancerDnsName });
  new CfnOutput(stack, "ApiEndpoint", { value: `https://${settings.hostname}` });
  return { targetGroup, loadBalancer };
}

function migrationRepository({ platform }: RuntimeContext) {
  return new ecr.Repository(platform.cluster.stack, "migrationRepository", {
    imageTagMutability: ecr.TagMutability.IMMUTABLE,
    imageScanOnPush: true,
    removalPolicy: RemovalPolicy.RETAIN,
  });
}

function administrator({ stack, data }: RuntimeContext) {
  return secrets.Secret.fromSecretAttributes(stack, "DatabaseAdministrator", {
    secretCompleteArn: data.database.attrMasterUserSecretSecretArn,
    encryptionKey: data.key,
  });
}

function serviceOutputs(
  ctx: RuntimeContext,
  values: {
    migration: ReturnType<typeof createTask>;
    repository: ecr.Repository;
    credential: secrets.Secret;
    release: ReturnType<typeof createReleaseParameters>;
    api: ReturnType<typeof createTask>;
    worker: ReturnType<typeof createTask>;
    targetGroup: elb.ApplicationTargetGroup;
  },
) {
  const { stack, platform } = ctx;
  const { migration, repository, credential, release, api, worker, targetGroup } = values;
  new CfnOutput(stack, "MigrationTaskDefinitionArn", { value: migration.task.taskDefinitionArn });
  new CfnOutput(stack, "MigrationRepositoryUri", { value: repository.repositoryUri });
  new CfnOutput(stack, "RuntimeCredentialSecretArn", { value: credential.secretArn });
  new CfnOutput(stack, "ReleaseSha", { value: release.app });
  const outputs = {
    MigrationRelease: release.migration,
    ClusterArn: platform.cluster.clusterArn,
    ApiRepositoryUri: platform.api.repositoryUri,
    WorkerRepositoryUri: platform.worker.repositoryUri,
    ApplicationSubnetIds: ctx.network.vpc.privateSubnets.map((s) => s.subnetId).join(","),
    MigrationSecurityGroupId: ctx.network.worker.securityGroupId,
    ApiTaskDefinitionArn: api.task.taskDefinitionArn,
    WorkerTaskDefinitionArn: worker.task.taskDefinitionArn,
    TargetGroupArn: targetGroup.targetGroupArn,
  };
  for (const [id, value] of Object.entries(outputs)) new CfnOutput(stack, id, { value });
}
