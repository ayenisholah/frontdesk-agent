import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import { z } from "zod";
const settings = z.object({
  prefix: z.string().min(1),
  perSecond: z.number().positive().max(10).default(10),
  recipientIntervalMs: z.number().int().min(6000).max(3_600_000).default(6000),
});
const reserve = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local sender = tonumber(redis.call('GET', KEYS[1]) or '0')
local recipient = tonumber(redis.call('GET', KEYS[2]) or '0')
local wait = math.max(sender, recipient) - now
if wait > 0 then return wait end
redis.call('SET', KEYS[1], now + tonumber(ARGV[1]), 'PX', tonumber(ARGV[1]) * 2)
redis.call('SET', KEYS[2], now + tonumber(ARGV[2]), 'PX', tonumber(ARGV[2]) * 2)
return 0`;
const hash = (id: string) => createHash("sha256").update(id).digest("hex");
export function createSendLimiter(
  redis: Pick<Redis, "eval">,
  input: { prefix: string; perSecond?: number; recipientIntervalMs?: number },
) {
  const parsed = settings.safeParse(input);
  if (!parsed.success) throw new Error("Invalid send limits");
  const { prefix, perSecond, recipientIntervalMs } = parsed.data;
  return async ({ senderId, recipientId }: { senderId: string; recipientId: string }) => {
    // Same hash tag keeps both keys in one Redis Cluster slot; keys contain no phone numbers.
    const sender = `${prefix}:{${hash(senderId)}}`;
    const wait = await redis.eval(
      reserve,
      2,
      sender,
      `${sender}:${hash(recipientId)}`,
      Math.ceil(1000 / perSecond),
      recipientIntervalMs,
    );
    return z.number().nonnegative().parse(wait);
  };
}
