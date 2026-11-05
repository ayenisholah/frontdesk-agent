import { describe, expect, it } from "vitest";
import { datesBetween, isSameDate, toLocal, toUtc, weekdayOf } from "../src/time";

const DETROIT = "America/Detroit";
const HELSINKI = "Europe/Helsinki";

describe("toLocal", () => {
  it("reads wall-clock time in a zone", () => {
    expect(toLocal(new Date("2026-07-01T12:30:00Z"), DETROIT)).toEqual({
      year: 2026,
      month: 7,
      day: 1,
      minute: 8 * 60 + 30,
    });
    expect(toLocal(new Date("2026-07-01T12:30:00Z"), HELSINKI)).toEqual({
      year: 2026,
      month: 7,
      day: 1,
      minute: 15 * 60 + 30,
    });
  });

  it("crosses the date line of the zone", () => {
    expect(toLocal(new Date("2026-07-01T02:00:00Z"), DETROIT)).toMatchObject({
      day: 30,
      month: 6,
      minute: 22 * 60,
    });
  });

  it("treats midnight as minute zero", () => {
    expect(toLocal(new Date("2026-07-01T04:00:00Z"), DETROIT).minute).toBe(0);
  });
});

describe("toUtc", () => {
  it("converts a normal wall-clock time", () => {
    expect(toUtc({ year: 2026, month: 7, day: 1 }, 9 * 60, DETROIT)?.toISOString()).toBe(
      "2026-07-01T13:00:00.000Z",
    );
    expect(toUtc({ year: 2026, month: 1, day: 15 }, 9 * 60, DETROIT)?.toISOString()).toBe(
      "2026-01-15T14:00:00.000Z",
    );
  });

  it("returns null for a time skipped when clocks go forward", () => {
    expect(toUtc({ year: 2026, month: 3, day: 8 }, 2 * 60 + 30, DETROIT)).toBeNull();
  });

  it("uses the first occurrence of a time repeated when clocks go back", () => {
    expect(toUtc({ year: 2026, month: 11, day: 1 }, 60 + 30, DETROIT)?.toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  });

  it("works on either side of a change", () => {
    expect(toUtc({ year: 2026, month: 3, day: 8 }, 3 * 60, DETROIT)?.toISOString()).toBe(
      "2026-03-08T07:00:00.000Z",
    );
    expect(toUtc({ year: 2026, month: 3, day: 8 }, 60, DETROIT)?.toISOString()).toBe(
      "2026-03-08T06:00:00.000Z",
    );
  });

  it("round-trips through toLocal", () => {
    const instant = toUtc({ year: 2026, month: 11, day: 5 }, 14 * 60 + 15, HELSINKI) as Date;
    expect(toLocal(instant, HELSINKI)).toEqual({
      year: 2026,
      month: 11,
      day: 5,
      minute: 14 * 60 + 15,
    });
  });
});

describe("calendar helpers", () => {
  it("finds the weekday", () => {
    expect(weekdayOf({ year: 2026, month: 11, day: 1 })).toBe(0);
    expect(weekdayOf({ year: 2026, month: 11, day: 7 })).toBe(6);
  });

  it("compares dates", () => {
    expect(isSameDate({ year: 2026, month: 1, day: 1 }, { year: 2026, month: 1, day: 1 })).toBe(
      true,
    );
    expect(isSameDate({ year: 2026, month: 1, day: 1 }, { year: 2026, month: 1, day: 2 })).toBe(
      false,
    );
  });

  it("lists dates across a month end", () => {
    expect(
      datesBetween({ year: 2026, month: 1, day: 30 }, { year: 2026, month: 2, day: 1 }),
    ).toEqual([
      { year: 2026, month: 1, day: 30 },
      { year: 2026, month: 1, day: 31 },
      { year: 2026, month: 2, day: 1 },
    ]);
  });

  it("returns nothing when the range is backwards", () => {
    expect(
      datesBetween({ year: 2026, month: 1, day: 2 }, { year: 2026, month: 1, day: 1 }),
    ).toEqual([]);
  });
});
