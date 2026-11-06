import type { Stack, aws_kms as kms } from "aws-cdk-lib";
import type { InfraConfig } from "./config";
import type { createNetwork } from "./network";
export type DataContext = {
  stack: Stack;
  config: InfraConfig;
  networking: ReturnType<typeof createNetwork>;
  key: kms.Key;
};
