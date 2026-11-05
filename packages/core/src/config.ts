// One business's configuration: what it sells, when it's open and how the agent should behave.
// Validated in one place, so the API, the seed, the dashboard settings editor and the agent
// all reject the same bad input with the same message. Pure: no I/O.
import { z } from "zod";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "08:30" -> 510. Assumes the value already matched HHMM. */
export function minuteOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** "510" -> "08:30". Inverse of minuteOfDay for 0–1439. */
export function formatMinuteOfDay(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const zones: ReadonlySet<string> = new Set(Intl.supportedValuesOf("timeZone"));

/** True for IANA zone names this runtime knows, including aliases such as "UTC". */
export function isTimeZone(value: string): boolean {
  if (zones.has(value)) return true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be lowercase letters, digits and single dashes");
const text = (max: number) => z.string().trim().min(1, "must not be empty").max(max);
const cents = z.number().int("must be a whole number of cents").min(0, "must be 0 or more");

const serviceSchema = z
  .object({
    id: slug,
    name: text(80),
    durationMinutes: z.number().int().min(5, "must be at least 5").max(600, "must be at most 600"),
    priceCents: cents,
    depositCents: cents,
  })
  // Skipped when the price itself is invalid, so one bad price reports one error.
  .refine((s) => s.priceCents < 0 || s.depositCents <= s.priceCents, {
    path: ["depositCents"],
    message: "must not be more than the price",
  });

const openingHoursSchema = z
  .object({
    weekday: z.number().int().min(0).max(6, "must be 0 (Sunday) to 6 (Saturday)"),
    open: z.string().regex(HHMM, 'must be a 24-hour time like "08:30"'),
    close: z.string().regex(HHMM, 'must be a 24-hour time like "17:00"'),
  })
  .refine((h) => minuteOfDay(h.open) < minuteOfDay(h.close), {
    path: ["close"],
    message: "must be after the opening time",
  });

export const businessConfigSchema = z
  .object({
    slug,
    name: text(120),
    timezone: z.string().refine(isTimeZone, "must be an IANA time zone like America/Detroit"),
    currency: z.string().regex(/^[A-Z]{3}$/, 'must be an ISO 4217 code like "USD"'),
    services: z.array(serviceSchema).min(1, "must list at least one service"),
    openingHours: z.array(openingHoursSchema).min(1, "must have at least one opening interval"),
    capacity: z.number().int().min(1, "must be at least 1").max(50),
    buffers: z.object({
      beforeMinutes: z.number().int().min(0).max(120),
      afterMinutes: z.number().int().min(0).max(120),
    }),
    cancellationWindowHours: z.number().int().min(0).max(168, "must be at most 168 (a week)"),
    faq: z.array(z.object({ question: text(300), answer: text(2000) })).max(100),
    tone: z.object({
      style: z.enum(["friendly", "professional", "casual"]),
      notes: z.string().trim().max(1000).optional(),
    }),
  })
  .superRefine((config, ctx) => {
    const seen = new Map<string, number>();
    config.services.forEach((s, i) => {
      const first = seen.get(s.id);
      if (first !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["services", i, "id"],
          message: `duplicates services[${first}].id "${s.id}"`,
        });
      } else seen.set(s.id, i);
    });

    // Intervals on the same weekday must not overlap. Touching ends (12:00 close, 12:00 open) are fine.
    const byDay = new Map<number, { i: number; start: number; end: number }[]>();
    config.openingHours.forEach((h, i) => {
      if (!HHMM.test(h.open) || !HHMM.test(h.close)) return;
      const list = byDay.get(h.weekday) ?? [];
      list.push({ i, start: minuteOfDay(h.open), end: minuteOfDay(h.close) });
      byDay.set(h.weekday, list);
    });
    for (const list of byDay.values()) {
      list.sort((a, b) => a.start - b.start);
      for (let k = 1; k < list.length; k++) {
        const prev = list[k - 1]!;
        const cur = list[k]!;
        if (cur.start < prev.end) {
          ctx.addIssue({
            code: "custom",
            path: ["openingHours", cur.i],
            message: `overlaps openingHours[${prev.i}] on the same weekday`,
          });
        }
      }
    }
  });

export type BusinessConfig = z.infer<typeof businessConfigSchema>;
export type ServiceConfig = BusinessConfig["services"][number];
export type OpeningHoursConfig = BusinessConfig["openingHours"][number];

export type ParseResult = { ok: true; config: BusinessConfig } | { ok: false; errors: string[] };

/** "services.1.priceCents" style paths rendered as "services[1].priceCents". */
function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const part of path) {
    if (typeof part === "number") out += `[${part}]`;
    else out += out ? `.${String(part)}` : String(part);
  }
  return out || "(config)";
}

/** Validates unknown input. Errors read like `services[1].priceCents: must be 0 or more`. */
export function parseBusinessConfig(input: unknown): ParseResult {
  const parsed = businessConfigSchema.safeParse(input);
  if (parsed.success) return { ok: true, config: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}`),
  };
}

/** Like parseBusinessConfig, but throws one error listing every problem. */
export function assertBusinessConfig(input: unknown): BusinessConfig {
  const result = parseBusinessConfig(input);
  if (!result.ok) throw new Error(`Invalid business config:\n- ${result.errors.join("\n- ")}`);
  return result.config;
}
