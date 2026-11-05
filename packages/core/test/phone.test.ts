import { describe, expect, it } from "vitest";
import { isE164, normalizePhone } from "../src/phone";

describe("normalizePhone", () => {
  it.each([
    ["+234 706 8785 102", "+2347068785102"],
    ["(+1) 415-555-0134", "+14155550134"],
    ["0044 20 7946 0958", "+442079460958"],
    ["2347068785102", "+2347068785102"],
  ])("normalizes %s", (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it.each(["", "hello", "+0123456789", "+12", "+1234567890123456"])("rejects %s", (raw) => {
    expect(normalizePhone(raw)).toBeNull();
  });

  it("validates canonical form only", () => {
    expect(isE164("+2347068785102")).toBe(true);
    expect(isE164("2347068785102")).toBe(false);
  });
});
