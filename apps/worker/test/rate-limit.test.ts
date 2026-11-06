import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import { createSendLimiter } from "../src/rate-limit";
const url = process.env.REDIS_URL;
describe.skipIf(!url)("shared delivery limits", () => {
  it("reserves sender and recipient capacity atomically across workers", async () => {
    const redis = new Redis(url!);
    const prefix = `test-${randomUUID()}`;
    const limit = createSendLimiter(redis, { prefix });
    try {
      const results = await Promise.all([
        limit({ senderId: "123", recipientId: "customer" }),
        limit({ senderId: "123", recipientId: "customer" }),
      ]);
      expect(results.filter((wait) => wait === 0)).toHaveLength(1);
      expect(Math.max(...results)).toBeGreaterThan(5000);
      expect(await limit({ senderId: "456", recipientId: "customer" })).toBe(0);
      expect(() => createSendLimiter(redis, { prefix, perSecond: 11 })).toThrow(
        "Invalid send limits",
      );
      expect(() => createSendLimiter(redis, { prefix, recipientIntervalMs: 100 })).toThrow(
        "Invalid send limits",
      );
      const slower = createSendLimiter(redis, { prefix, perSecond: 1, recipientIntervalMs: 7000 });
      expect(await slower({ senderId: "789", recipientId: "a" })).toBe(0);
      expect(await slower({ senderId: "789", recipientId: "b" })).toBeGreaterThan(500);
    } finally {
      const keys = await redis.keys(`${prefix}:*`);
      if (keys.length) await redis.del(...keys);
      redis.disconnect();
    }
  });
});
