import { describe, expect, it } from "vitest";
import {
  assertBusinessConfig,
  formatMinuteOfDay,
  isTimeZone,
  minuteOfDay,
  parseBusinessConfig,
  type BusinessConfig,
} from "../src/config";
import { harborPaws } from "../src/fixtures/harbor-paws";

const clone = (): BusinessConfig => structuredClone(harborPaws);

function errorsFor(mutate: (c: BusinessConfig) => void): string[] {
  const c = clone();
  mutate(c);
  const result = parseBusinessConfig(c);
  if (result.ok) throw new Error("expected the config to be rejected");
  return result.errors;
}

describe("business config", () => {
  it("accepts the pilot fixture unchanged", () => {
    const result = parseBusinessConfig(harborPaws);
    expect(result).toEqual({ ok: true, config: harborPaws });
  });

  it.each<[string, (c: BusinessConfig) => void, string]>([
    [
      "a negative price",
      (c) => void (c.services[1]!.priceCents = -500),
      "services[1].priceCents: must be 0 or more",
    ],
    [
      "fractional cents",
      (c) => void (c.services[0]!.priceCents = 40.5),
      "services[0].priceCents: must be a whole number of cents",
    ],
    [
      "a deposit above the price",
      (c) => void (c.services[1]!.depositCents = 9000),
      "services[1].depositCents: must not be more than the price",
    ],
    [
      "an unknown time zone",
      (c) => void (c.timezone = "Mars/Olympus"),
      "timezone: must be an IANA time zone like America/Detroit",
    ],
    [
      "overlapping hours",
      (c) => void c.openingHours.push({ weekday: 1, open: "16:00", close: "19:00" }),
      "openingHours[6]: overlaps openingHours[0] on the same weekday",
    ],
    [
      "close before open",
      (c) => void (c.openingHours[0]!.close = "07:00"),
      "openingHours[0].close: must be after the opening time",
    ],
    [
      "a malformed time",
      (c) => void (c.openingHours[0]!.open = "8am"),
      'openingHours[0].open: must be a 24-hour time like "08:30"',
    ],
    [
      "a duplicate service id",
      (c) => void (c.services[3]!.id = "bath-short-coat"),
      'services[3].id: duplicates services[0].id "bath-short-coat"',
    ],
    ["no services", (c) => void (c.services = []), "services: must list at least one service"],
    ["zero capacity", (c) => void (c.capacity = 0), "capacity: must be at least 1"],
    [
      "a lowercase currency",
      (c) => void (c.currency = "usd"),
      'currency: must be an ISO 4217 code like "USD"',
    ],
  ])("rejects %s with a clear error", (_label, mutate, expected) => {
    expect(errorsFor(mutate)).toContain(expected);
  });

  it("allows split shifts that touch but don't overlap", () => {
    const c = clone();
    c.openingHours = [
      { weekday: 2, open: "08:00", close: "12:00" },
      { weekday: 2, open: "12:00", close: "17:00" },
      { weekday: 3, open: "12:00", close: "17:00" },
    ];
    expect(parseBusinessConfig(c).ok).toBe(true);
  });

  it("reports every problem at once", () => {
    const errors = errorsFor((c) => {
      c.timezone = "Nowhere/Land";
      c.services[0]!.priceCents = -1;
    });
    expect(errors).toHaveLength(2);
  });

  it("assertBusinessConfig returns a valid config", () => {
    expect(assertBusinessConfig(clone()).services).toHaveLength(harborPaws.services.length);
  });

  it("assertBusinessConfig throws a readable message", () => {
    expect(() => assertBusinessConfig({ ...clone(), capacity: -3 })).toThrow(
      /Invalid business config:\n- capacity: must be at least 1/,
    );
  });
});

describe("config error paths", () => {
  it("labels an error on the whole document as (config)", () => {
    const result = parseBusinessConfig(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/^\(config\): /);
  });
});

describe("time helpers", () => {
  it("round-trips minutes of the day", () => {
    expect(minuteOfDay("08:30")).toBe(510);
    expect(formatMinuteOfDay(510)).toBe("08:30");
    expect(formatMinuteOfDay(minuteOfDay("23:59"))).toBe("23:59");
  });

  it("recognises IANA zones and aliases", () => {
    expect(isTimeZone("America/Detroit")).toBe(true);
    expect(isTimeZone("Africa/Lagos")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
  });
});
