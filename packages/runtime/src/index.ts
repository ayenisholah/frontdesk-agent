import { z } from "zod";
const host = z
  .string()
  .regex(/^[a-zA-Z0-9.-]+$/)
  .min(1)
  .max(253);
const schema = z.object({
  DATABASE_HOST: host,
  DATABASE_NAME: z.string().regex(/^[a-z][a-z0-9_]*$/),
  DATABASE_USER: z.string().min(1),
  DATABASE_PASSWORD: z.string().min(1),
  REDIS_HOST: host,
  REDIS_PASSWORD: z.string().min(1),
  NODE_EXTRA_CA_CERTS: z.string().startsWith("/"),
  DATABASE_URL: z.undefined().optional(),
  REDIS_URL: z.undefined().optional(),
  NODE_TLS_REJECT_UNAUTHORIZED: z.literal("1").optional(),
});
/** Cloud credentials are ECS secret injections, never synthesized connection URLs. */
export function resolveRuntimeEnvironment(env: Record<string, string | undefined>) {
  if (env.CLOUD_RUNTIME === undefined || env.CLOUD_RUNTIME === "false") return env;
  const parsed = schema.safeParse(env);
  if (env.CLOUD_RUNTIME !== "true" || !parsed.success)
    throw new Error("Invalid cloud runtime configuration");
  const config = parsed.data;
  const database = new URL(`postgresql://${config.DATABASE_HOST}:5432/${config.DATABASE_NAME}`);
  database.username = config.DATABASE_USER;
  database.password = config.DATABASE_PASSWORD;
  database.searchParams.set("sslmode", "verify-full");
  const redis = new URL(`rediss://${config.REDIS_HOST}:6379`);
  redis.password = config.REDIS_PASSWORD;
  return { ...env, DATABASE_URL: database.toString(), REDIS_URL: redis.toString() };
}
