import { z } from "zod";
export const monitoringSchema = z.strictObject({
  actionsEnabled: z.boolean().default(false),
  heartbeatMinutes: z.number().int().min(1).max(60).default(3),
  errorCount: z.number().int().positive().default(5),
  utilizationPercent: z.number().min(1).max(100).default(80),
  freeStoragePercent: z.number().min(1).max(99).default(20),
});
