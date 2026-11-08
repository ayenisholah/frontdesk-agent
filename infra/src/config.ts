import { z } from "zod";
import { monitoringSchema } from "./monitoring-config";
const schema = z.strictObject({
  monitoring: monitoringSchema.optional(),
  deployment: z
    .strictObject({
      enabled: z.literal(true),
      providerArn: z
        .string()
        .regex(/^arn:aws:iam::\d{12}:oidc-provider\/token\.actions\.githubusercontent\.com$/)
        .optional(),
    })
    .optional(),
  runtime: z
    .strictObject({
      hostname: z.string().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
      releaseSha: z.string().regex(/^[a-f0-9]{40}$/),
      certificateArn: z.string().regex(/^arn:aws:acm:eu-west-1:\d{12}:certificate\/[a-f0-9-]{36}$/),
      desiredCount: z.union([z.literal(0), z.literal(1)]).default(0),
      databasePrepared: z.boolean().default(false),
    })
    .refine((v) => v.desiredCount === 0 || v.databasePrepared)
    .optional(),
  stage: z.literal("pilot").default("pilot"),
  account: z.string().regex(/^\d{12}$/),
  region: z.literal("eu-west-1").default("eu-west-1"),
  cidr: z
    .string()
    .regex(/^10\.(?:\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.0\.0\/16$/)
    .default("10.42.0.0/16"),
  availabilityZones: z
    .tuple([z.string().regex(/^eu-west-1[a-z]$/), z.string().regex(/^eu-west-1[a-z]$/)])
    .refine(([a, b]) => a !== b),
});
export type InfraConfig = z.infer<typeof schema>;
export function parseInfraConfig(input: unknown): InfraConfig {
  const result = schema.safeParse(input);
  if (
    !result.success ||
    ((result.data.deployment || result.data.monitoring) && !result.data.runtime) ||
    (result.data.deployment?.providerArn &&
      !result.data.deployment.providerArn.includes(`::${result.data.account}:`)) ||
    (result.data.runtime &&
      !result.data.runtime.certificateArn.includes(`:${result.data.account}:certificate/`))
  )
    throw new Error("Invalid infrastructure configuration");
  return result.data;
}
