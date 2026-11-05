import pg from "pg";
import { Redis } from "ioredis";

export type Check = () => Promise<void>;

/** The parts of a Postgres pool that readiness needs. */
export interface PostgresProbe {
  query(sql: string): Promise<unknown>;
}

/** The parts of a Redis client that readiness needs. */
export interface RedisProbe {
  readonly status: string;
  connect(): Promise<void>;
  ping(): Promise<string>;
}

const CHECK_TIMEOUT_MS = 2000;

/** Connection errors surface through readiness checks, not as process crashes. */
const ignoreConnectionError = () => {};

export const withTimeout = <T>(p: Promise<T>, ms: number, name: string) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${name} timed out`)), ms).unref(),
    ),
  ]);

export function createChecks(
  postgres: PostgresProbe,
  redis: RedisProbe,
  timeoutMs = CHECK_TIMEOUT_MS,
): Record<string, Check> {
  return {
    postgres: async () => {
      await withTimeout(postgres.query("SELECT 1"), timeoutMs, "postgres");
    },
    redis: async () => {
      if (redis.status === "wait" || redis.status === "end")
        await withTimeout(redis.connect(), timeoutMs, "redis");
      const pong = await withTimeout(redis.ping(), timeoutMs, "redis");
      if (pong !== "PONG") throw new Error("redis returned unexpected reply");
    },
  };
}

export function createDependencies(databaseUrl: string, redisUrl: string) {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 5,
    connectionTimeoutMillis: CHECK_TIMEOUT_MS,
  });
  pool.on("error", ignoreConnectionError);
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  redis.on("error", ignoreConnectionError);
  const probe: PostgresProbe = { query: (sql) => pool.query(sql) };
  const close = async () => {
    await Promise.allSettled([pool.end(), redis.quit()]);
  };
  return { checks: createChecks(probe, redis), close };
}
