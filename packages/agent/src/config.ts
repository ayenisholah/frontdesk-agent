import { z } from "zod";

const model = z.string().regex(/^eu\.[a-z0-9.:-]+$/);
const rate = z.object({
  inputMicrosPerToken: z.number().positive(),
  outputMicrosPerToken: z.number().positive(),
});
const schema = z
  .object({
    region: z.enum([
      "eu-west-1",
      "eu-west-3",
      "eu-central-1",
      "eu-north-1",
      "eu-south-1",
      "eu-south-2",
    ]),
    modelId: model,
    smallModelId: model,
    rates: z.object({ version: z.string().min(1), models: z.record(model, rate) }),
  })
  .refine((v) => Boolean(v.rates.models[v.modelId] && v.rates.models[v.smallModelId]));

export type AgentConfig = z.infer<typeof schema>;

/** Never include environment values in a validation error. */
export function parseAgentConfig(env: Record<string, string | undefined>): AgentConfig {
  try {
    return schema.parse({
      region: env.AWS_REGION,
      modelId: env.BEDROCK_MODEL_ID,
      smallModelId: env.BEDROCK_MODEL_ID_SMALL,
      rates: JSON.parse(env.BEDROCK_RATES ?? "null") as unknown,
    });
  } catch {
    throw new Error("Invalid agent configuration: EU region, models and versioned rates required");
  }
}
