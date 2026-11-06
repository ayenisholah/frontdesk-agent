import { z } from "zod";
const schema = z.object({
  DEPLOY_ENABLED: z.literal("true"),
  AWS_ACCOUNT_ID: z.string().regex(/^\d{12}$/),
  AWS_REGION: z.literal("eu-west-1"),
  RUNTIME_STACK: z.literal("frontdesk-pilot-runtime"),
  AWS_DEPLOY_ROLE_ARN: z
    .string()
    .regex(/^arn:aws:iam::\d{12}:role\/frontdesk-pilot-github-release$/),
  CLOUDFORMATION_ROLE_ARN: z
    .string()
    .regex(/^arn:aws:iam::\d{12}:role\/frontdesk-pilot-cloudformation-release$/),
  GITHUB_RUN_ID: z.string().regex(/^\d+$/),
  GITHUB_RUN_ATTEMPT: z.string().regex(/^\d+$/),
});
export function parseDeploymentConfig(env: Record<string, string | undefined>) {
  const result = schema.safeParse(env);
  if (
    !result.success ||
    !result.data.CLOUDFORMATION_ROLE_ARN.includes(`::${result.data.AWS_ACCOUNT_ID}:`) ||
    !result.data.AWS_DEPLOY_ROLE_ARN.includes(`::${result.data.AWS_ACCOUNT_ID}:`)
  )
    throw new Error("Invalid deployment configuration");
  const c = result.data;
  return {
    account: c.AWS_ACCOUNT_ID,
    region: c.AWS_REGION,
    stack: c.RUNTIME_STACK,
    roleArn: c.CLOUDFORMATION_ROLE_ARN,
    requestId: `${c.GITHUB_RUN_ID}-${c.GITHUB_RUN_ATTEMPT}`,
  };
}
export type DeploymentConfig = ReturnType<typeof parseDeploymentConfig>;
