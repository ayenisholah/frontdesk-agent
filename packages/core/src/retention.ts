export const DEFAULT_RETENTION_DAYS = 90;
export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}
