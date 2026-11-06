import { Stack } from "aws-cdk-lib";
import type { Construct } from "constructs";
import type { InfraConfig } from "./config";
export function createStack(scope: Construct, name: string, config: InfraConfig) {
  return new Stack(scope, `frontdesk-${config.stage}-${name}`, {
    env: { account: config.account, region: config.region },
    terminationProtection: true,
  });
}
