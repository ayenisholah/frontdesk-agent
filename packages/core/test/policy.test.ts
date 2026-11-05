import { describe, expect, it } from "vitest";
import { canChangeBooking } from "../src/policy";

const startsAt = new Date("2026-07-02T12:00:00Z");

describe("canChangeBooking", () => {
  it("allows a change before the window", () => {
    expect(
      canChangeBooking({ startsAt, now: new Date("2026-07-01T11:00:00Z"), windowHours: 24 }),
    ).toEqual({
      allowed: true,
    });
  });

  it("allows a change exactly on the boundary", () => {
    expect(
      canChangeBooking({ startsAt, now: new Date("2026-07-01T12:00:00Z"), windowHours: 24 })
        .allowed,
    ).toBe(true);
  });

  it("refuses inside the window, with the policy text", () => {
    expect(
      canChangeBooking({ startsAt, now: new Date("2026-07-01T12:00:01Z"), windowHours: 24 }),
    ).toEqual({
      allowed: false,
      policy: "Bookings can be cancelled or moved up to 24 hours before the appointment.",
    });
  });

  it("allows anything before the start when there is no window", () => {
    expect(canChangeBooking({ startsAt, now: startsAt, windowHours: 0 }).allowed).toBe(true);
  });
});
