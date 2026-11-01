import pg from "pg";
import { Redis } from "ioredis";

export type Check = () => Promise<void>;

const withTimeout = <T>(p: Promise<T>, ms: number, name: string) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${name} timed out`)), ms).unref()),
  ]);

export function createDependencies(databaseUrl: string, redisUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 2000 });
  pool.on("error", () => {}); // idle-client errors surface through readiness, not crashes
  const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  redis.on("error", () => {});
  const checks: Record<string, Check> = {
    postgres: async () => {
      await withTimeout(pool.query("SELECT 1"), 2000, "postgres");
    },
    redis: async () => {
      if (redis.status === "wait" || redis.status === "end") await withTimeout(redis.connect(), 2000, "redis");
      const pong = await withTimeout(redis.ping(), 2000, "redis");
      if (pong !== "PONG") throw new Error("redis returned unexpected reply");
    },
  };
  const close = async () => {
    await Promise.allSettled([pool.end(), redis.quit()]);
  };
  return { checks, close };
}
