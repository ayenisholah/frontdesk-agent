import { z } from "zod";

const schema = z
  .object({
    WHATSAPP_WEBHOOK_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    WHATSAPP_APP_SECRET: z.string().min(1).optional(),
    WHATSAPP_VERIFY_TOKEN: z.string().min(1).optional(),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3110),
    HOST: z.string().default("0.0.0.0"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    RELEASE_SHA: z.string().default("dev"),
  })
  .refine(
    (config) =>
      !config.WHATSAPP_WEBHOOK_ENABLED ||
      Boolean(config.WHATSAPP_APP_SECRET && config.WHATSAPP_VERIFY_TOKEN),
    { path: ["WHATSAPP_APP_SECRET/WHATSAPP_VERIFY_TOKEN"] },
  );

export type Config = z.infer<typeof schema>;

/** Validates the environment once at startup. Error messages name the variable, never its value. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid configuration: ${fields}`);
  }
  return parsed.data;
}
