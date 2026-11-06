import { App, CfnOutput, Tags } from "aws-cdk-lib";
import type { InfraConfig } from "./config";
import { applySecurityChecks } from "./security";
import { createStack } from "./stack";
import { createNetwork } from "./network";
import { createDataServices } from "./data";
import { createPlatform } from "./platform";
import { createDeploymentAccess } from "./deployment-access";
import { createServices } from "./services";
export function createFoundation(config: InfraConfig) {
  const app = new App({
    context: {
      "@aws-cdk/aws-ec2:restrictDefaultSecurityGroup": true,
      "@aws-cdk/core:defaultCrossStackReferences": "strong",
      [`availability-zones:account=${config.account}:region=${config.region}`]:
        config.availabilityZones,
    },
  });
  const platform = createStack(app, "platform", config);
  const network = createStack(app, "network", config);
  const networking = createNetwork(network, config);
  const data = createStack(app, "data", config);
  const dataServices = createDataServices(data, networking, config);
  const resources = createPlatform(platform, networking.vpc);
  const runtime = config.runtime ? createStack(app, "runtime", config) : undefined;
  let access;
  if (runtime && config.runtime) {
    const context = {
      stack: runtime,
      dataStack: data,
      config,
      settings: config.runtime,
      network: networking,
      data: dataServices,
      platform: resources,
    };
    const services = createServices(context);
    if (config.deployment) access = createDeploymentAccess(context, services);
  }
  Tags.of(app).add("Project", "frontdesk");
  Tags.of(app).add("Stage", config.stage);
  Tags.of(app).add("ManagedBy", "cdk");
  new CfnOutput(platform, "Region", { value: config.region });
  applySecurityChecks(app);
  return { app, platform, network, networking, data, runtime, access };
}
