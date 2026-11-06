import { z } from "zod";
const flag = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");
const schema = z
  .object({
    database: z.url().startsWith("postgres"),
    redis: z.url().regex(/^rediss?:\/\//),
    inbound: flag,
    outbound: flag,
    retention: flag,
    days: z.coerce.number().int().min(1).max(3650).default(90),
    port: z.coerce.number().int().min(1).max(65535).default(3111),
    prefix: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/)
      .default("frontdesk"),
  })
  .refine((v) => !(v.inbound || v.outbound) || v.retention);
export function parseWorkerConfig(env: Record<string, string | undefined>) {
  const parsed = schema.safeParse({
    database: env.DATABASE_URL,
    redis: env.REDIS_URL,
    inbound: env.INBOUND_WORKER_ENABLED,
    outbound: env.OUTBOUND_WORKER_ENABLED,
    retention: env.CONTENT_RETENTION_ENABLED,
    days: env.CONTENT_RETENTION_DAYS,
    port: env.WORKER_PORT,
    prefix: env.QUEUE_PREFIX,
  });
  if (!parsed.success) throw new Error("Invalid worker configuration");
  return parsed.data;
}
