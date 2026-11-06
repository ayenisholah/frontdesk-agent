import { z } from "zod";
const schema = z.strictObject({
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
  if (!result.success) throw new Error("Invalid infrastructure configuration");
  return result.data;
}
