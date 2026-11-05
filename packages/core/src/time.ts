// Converts between UTC instants and wall-clock time in a named zone, using Intl only.
// Bookings are stored as instants; opening hours are wall-clock times in the business's zone.

export type LocalDate = { year: number; month: number; day: number };
export type LocalTime = LocalDate & { minute: number };

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  const existing = formatters.get(zone);
  if (existing) return existing;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  });
  formatters.set(zone, created);
  return created;
}

/** Wall-clock date and minute of day for an instant in a zone. */
export function toLocal(instant: Date, zone: string): LocalTime {
  const parts = new Map(
    formatter(zone)
      .formatToParts(instant)
      .map((p) => [p.type, Number(p.value)]),
  );
  return {
    year: parts.get("year") as number,
    month: parts.get("month") as number,
    day: parts.get("day") as number,
    minute: (parts.get("hour") as number) * 60 + (parts.get("minute") as number),
  };
}

const wallMs = ({ year, month, day, minute }: LocalTime) =>
  Date.UTC(year, month - 1, day, 0, minute);

function offsetMs(instant: Date, zone: string): number {
  return wallMs(toLocal(instant, zone)) - Math.floor(instant.getTime() / MINUTE_MS) * MINUTE_MS;
}

/**
 * The instant a wall-clock time happens in a zone. Returns null for a time skipped by a clock
 * change, and the first occurrence for a time that happens twice.
 */
export function toUtc(date: LocalDate, minute: number, zone: string): Date | null {
  const wall = wallMs({ ...date, minute });
  const offsets = new Set([-DAY_MS, DAY_MS].map((shift) => offsetMs(new Date(wall + shift), zone)));
  const matches = [...offsets]
    .map((offset) => new Date(wall - offset))
    .filter((candidate) => wallMs(toLocal(candidate, zone)) === wall)
    .sort((a, b) => a.getTime() - b.getTime());
  return matches[0] ?? null;
}

const dateMs = ({ year, month, day }: LocalDate) => Date.UTC(year, month - 1, day);

/** 0 = Sunday … 6 = Saturday. */
export const weekdayOf = (date: LocalDate) => new Date(dateMs(date)).getUTCDay();

export const isSameDate = (a: LocalDate, b: LocalDate) => dateMs(a) === dateMs(b);

/** Every calendar date from `first` to `last`, inclusive. */
export function datesBetween(first: LocalDate, last: LocalDate): LocalDate[] {
  const dates: LocalDate[] = [];
  for (let ms = dateMs(first); ms <= dateMs(last); ms += DAY_MS) {
    const d = new Date(ms);
    dates.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
  }
  return dates;
}
