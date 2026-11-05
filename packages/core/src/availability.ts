// The availability engine: which appointment slots a business can offer. Pure, no I/O.
// The agent may only offer or hold times this returns (GR-2).
import { minuteOfDay, type BusinessConfig, type ServiceConfig } from "./config";
import { datesBetween, isSameDate, toLocal, toUtc, weekdayOf, type LocalDate } from "./time";

const SLOT_STEP_MINUTES = 15;
const MINUTE_MS = 60_000;

export type Interval = { startsAt: Date; endsAt: Date };

type Rules = Pick<BusinessConfig, "timezone" | "openingHours" | "capacity" | "buffers">;

type Context = {
  config: Rules;
  service: Pick<ServiceConfig, "durationMinutes">;
  now: Date;
  /** Bookings and active holds that already occupy time. */
  busy: readonly Interval[];
};

export type SlotQuery = Context & { from: Date; to: Date };

const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * MINUTE_MS);

/** The appointment must end on the same local day, by closing time. Checked on the real end instant. */
function endsInHours(end: Date, date: LocalDate, closeMinute: number, zone: string) {
  const local = toLocal(end, zone);
  return isSameDate(local, date) && local.minute <= closeMinute;
}

function slotsOnDate(
  date: LocalDate,
  { config, service }: Pick<Context, "config" | "service">,
): Interval[] {
  const slots: Interval[] = [];
  const weekday = weekdayOf(date);
  for (const hours of config.openingHours.filter((h) => h.weekday === weekday)) {
    const close = minuteOfDay(hours.close);
    for (let minute = minuteOfDay(hours.open); minute < close; minute += SLOT_STEP_MINUTES) {
      const startsAt = toUtc(date, minute, config.timezone);
      if (!startsAt) continue;
      const endsAt = addMinutes(startsAt, service.durationMinutes);
      if (endsInHours(endsAt, date, close, config.timezone)) slots.push({ startsAt, endsAt });
    }
  }
  return slots;
}

/** Most intervals running at the same moment. Back-to-back intervals don't count as overlapping. */
function peakOverlap(intervals: readonly Interval[]): number {
  const events = intervals
    .flatMap((i) => [
      { at: i.startsAt.getTime(), change: 1 },
      { at: i.endsAt.getTime(), change: -1 },
    ])
    .sort((a, b) => a.at - b.at || a.change - b.change);
  let running = 0;
  let peak = 0;
  for (const event of events) {
    running += event.change;
    peak = Math.max(peak, running);
  }
  return peak;
}

function isFree(slot: Interval, { config, busy }: Pick<Context, "config" | "busy">): boolean {
  const { beforeMinutes, afterMinutes } = config.buffers;
  const widen = (i: Interval) => ({
    startsAt: addMinutes(i.startsAt, -beforeMinutes),
    endsAt: addMinutes(i.endsAt, afterMinutes),
  });
  const window = widen(slot);
  const clashes = busy
    .map(widen)
    .filter((b) => b.startsAt < window.endsAt && b.endsAt > window.startsAt);
  return peakOverlap(clashes) < config.capacity;
}

/** Free slots starting in [from, to), in time order. Past slots are never offered. */
export function findSlots(query: SlotQuery): Interval[] {
  const { config, from, to, now } = query;
  return datesBetween(toLocal(from, config.timezone), toLocal(to, config.timezone))
    .flatMap((date) => slotsOnDate(date, query))
    .filter((s) => s.startsAt >= from && s.startsAt < to && s.startsAt >= now)
    .filter((s) => isFree(s, query))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** True only for a time the engine would offer, so an invented time is refused (GR-2). */
export function isSlotAvailable({ startsAt, ...context }: Context & { startsAt: Date }): boolean {
  return findSlots({ ...context, from: startsAt, to: addMinutes(startsAt, 1) }).length === 1;
}
