import type { Stack } from "aws-cdk-lib";
import type { InfraConfig } from "./config";
import type { createNetwork } from "./network";
import type { createDataServices } from "./data";
import type { createPlatform } from "./platform";
export type RuntimeContext = {
  stack: Stack;
  dataStack: Stack;
  config: InfraConfig;
  settings: NonNullable<InfraConfig["runtime"]>;
  network: ReturnType<typeof createNetwork>;
  data: ReturnType<typeof createDataServices>;
  platform: ReturnType<typeof createPlatform>;
};
