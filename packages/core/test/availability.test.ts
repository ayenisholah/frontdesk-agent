import { describe, expect, it } from "vitest";
import { findSlots, isSlotAvailable, type Interval, type SlotQuery } from "../src/availability";

const ZONE = "America/Detroit";

// Weekdays 09:00-12:00, one worker, no buffers. 2026-07-01 is a Wednesday; Detroit is UTC-4.
const config: SlotQuery["config"] = {
  timezone: ZONE,
  openingHours: [{ weekday: 3, open: "09:00", close: "12:00" }],
  capacity: 1,
  buffers: { beforeMinutes: 0, afterMinutes: 0 },
};
const hour = { durationMinutes: 60 };
const at = (time: string) => new Date(`2026-07-01T${time}:00-04:00`);
const job = (start: string, end: string): Interval => ({ startsAt: at(start), endsAt: at(end) });

const query = (over: Partial<SlotQuery> = {}): SlotQuery => ({
  config,
  service: hour,
  from: at("00:00"),
  to: at("23:59"),
  now: new Date("2026-06-01T00:00:00Z"),
  busy: [],
  ...over,
});

const starts = (slots: Interval[]) =>
  slots.map((s) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit" }).format(
      s.startsAt,
    ),
  );

describe("findSlots", () => {
  it("steps every 15 minutes and sets the end from the duration", () => {
    const slots = findSlots(query());
    expect(starts(slots)).toEqual([
      "09:00",
      "09:15",
      "09:30",
      "09:45",
      "10:00",
      "10:15",
      "10:30",
      "10:45",
      "11:00",
    ]);
    expect(slots[0]?.endsAt).toEqual(at("10:00"));
  });

  it("offers nothing on a closed day", () => {
    const thursday = new Date("2026-07-02T00:00:00-04:00");
    expect(findSlots(query({ from: thursday, to: new Date("2026-07-02T23:59:00-04:00") }))).toEqual(
      [],
    );
  });

  it("never lets a job end after closing, but allows ending exactly at close", () => {
    expect(starts(findSlots(query())).at(-1)).toBe("11:00");
    expect(findSlots(query({ service: { durationMinutes: 240 } }))).toEqual([]);
  });

  it("uses every interval of a split day, in order", () => {
    const split = {
      ...config,
      openingHours: [
        { weekday: 3, open: "14:00", close: "15:00" },
        { weekday: 3, open: "09:00", close: "10:00" },
      ],
    };
    expect(starts(findSlots(query({ config: split })))).toEqual(["09:00", "14:00"]);
  });

  it("only returns slots starting inside the range", () => {
    expect(starts(findSlots(query({ from: at("10:00"), to: at("10:30") })))).toEqual([
      "10:00",
      "10:15",
    ]);
  });

  it("spans several days", () => {
    const week = {
      ...config,
      openingHours: [
        { weekday: 3, open: "09:00", close: "10:00" },
        { weekday: 4, open: "09:00", close: "10:00" },
      ],
    };
    const slots = findSlots(query({ config: week, to: new Date("2026-07-02T23:00:00-04:00") }));
    expect(slots).toHaveLength(2);
    expect(slots[1]?.startsAt.toISOString()).toBe("2026-07-02T13:00:00.000Z");
  });

  it("never offers a slot that has already started", () => {
    expect(starts(findSlots(query({ now: at("10:40") }))).at(0)).toBe("10:45");
    expect(starts(findSlots(query({ now: at("10:45") }))).at(0)).toBe("10:45");
  });

  it("blocks time taken by a booking or an active hold", () => {
    const slots = starts(findSlots(query({ busy: [job("10:00", "11:00")] })));
    expect(slots).toEqual(["09:00", "11:00"]);
  });

  it("allows back-to-back jobs when there are no buffers", () => {
    expect(starts(findSlots(query({ busy: [job("09:00", "10:00")] }))).at(0)).toBe("10:00");
  });

  it("keeps the buffers between jobs", () => {
    const buffered = { ...config, buffers: { beforeMinutes: 15, afterMinutes: 15 } };
    const slots = starts(findSlots(query({ config: buffered, busy: [job("10:00", "11:00")] })));
    expect(slots).toEqual([]);
    const earlier = starts(findSlots(query({ config: buffered, busy: [job("11:00", "12:00")] })));
    expect(earlier).toEqual(["09:00", "09:15", "09:30"]);
  });

  it("lets buffers run past opening and closing time", () => {
    const buffered = { ...config, buffers: { beforeMinutes: 30, afterMinutes: 30 } };
    const slots = starts(findSlots(query({ config: buffered })));
    expect(slots.at(0)).toBe("09:00");
    expect(slots.at(-1)).toBe("11:00");
  });

  it("allows up to capacity jobs at once", () => {
    const two = { ...config, capacity: 2 };
    const one = [job("10:00", "11:00")];
    expect(starts(findSlots(query({ config: two, busy: one })))).toContain("10:00");
    const both = [job("10:00", "11:00"), job("10:00", "11:00")];
    expect(starts(findSlots(query({ config: two, busy: both })))).not.toContain("10:00");
  });

  it("counts jobs running at the same moment, not every job touching the slot", () => {
    const two = { ...config, capacity: 2 };
    const sequential = [job("09:00", "10:00"), job("10:00", "11:00")];
    const long = { durationMinutes: 120 };
    expect(starts(findSlots(query({ config: two, service: long, busy: sequential })))).toContain(
      "09:00",
    );
  });

  it("skips a time removed by the clocks going forward", () => {
    const night = { ...config, openingHours: [{ weekday: 0, open: "01:00", close: "04:00" }] };
    const slots = findSlots(
      query({
        config: night,
        service: { durationMinutes: 30 },
        now: new Date("2026-01-01T00:00:00Z"),
        from: new Date("2026-03-08T00:00:00-05:00"),
        to: new Date("2026-03-08T23:00:00-04:00"),
      }),
    );
    const times = starts(slots);
    expect(times).toContain("01:45");
    expect(times).not.toContain("02:00");
    expect(times).not.toContain("02:30");
    expect(times).toContain("03:00");
  });

  it("measures real elapsed time across the clocks going forward", () => {
    const night = { ...config, openingHours: [{ weekday: 0, open: "01:00", close: "03:30" }] };
    const slots = findSlots(
      query({
        config: night,
        service: { durationMinutes: 60 },
        now: new Date("2026-01-01T00:00:00Z"),
        from: new Date("2026-03-08T00:00:00-05:00"),
        to: new Date("2026-03-08T23:00:00-04:00"),
      }),
    );
    // 01:45 + 60 real minutes is 03:45 on the clock, past closing.
    expect(starts(slots).at(-1)).toBe("01:30");
  });

  it("offers a repeated hour once when the clocks go back", () => {
    const night = { ...config, openingHours: [{ weekday: 0, open: "01:00", close: "03:00" }] };
    const slots = findSlots(
      query({
        config: night,
        service: { durationMinutes: 15 },
        from: new Date("2026-11-01T00:00:00-04:00"),
        to: new Date("2026-11-01T23:00:00-05:00"),
      }),
    );
    expect(starts(slots).filter((t) => t === "01:30")).toHaveLength(1);
    expect(slots.find((s) => starts([s])[0] === "01:30")?.startsAt.toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  });

  it("refuses a job that would run past midnight", () => {
    const late = { ...config, openingHours: [{ weekday: 3, open: "23:00", close: "23:59" }] };
    expect(findSlots(query({ config: late, service: { durationMinutes: 90 } }))).toEqual([]);
  });
});

describe("isSlotAvailable", () => {
  const context = { config, service: hour, now: new Date("2026-06-01T00:00:00Z"), busy: [] };

  it("accepts a real free slot", () => {
    expect(isSlotAvailable({ ...context, startsAt: at("09:15") })).toBe(true);
  });

  it("refuses a time off the 15-minute grid", () => {
    expect(isSlotAvailable({ ...context, startsAt: at("09:07") })).toBe(false);
  });

  it("refuses a time outside opening hours", () => {
    expect(isSlotAvailable({ ...context, startsAt: at("15:00") })).toBe(false);
  });

  it("refuses a taken slot", () => {
    expect(
      isSlotAvailable({ ...context, busy: [job("09:00", "10:00")], startsAt: at("09:15") }),
    ).toBe(false);
  });
});
