import { expect, it } from "vitest";
import { messagePolicy } from "../src/messaging";
const now = new Date("2031-03-03T12:00:00Z");
const recent = new Date(now.getTime() - 1000);
it("permits only current-window text or verified fixed templates", () => {
  const base = { now, lastInbound: recent, status: "agent", allowOwner: false, template: null };
  expect(messagePolicy(base)).toBe("text");
  expect(messagePolicy({ ...base, lastInbound: new Date(now.getTime() - 86_400_000) })).toBe(
    "suppress",
  );
  const template = { verifiedAt: recent };
  expect(messagePolicy({ ...base, lastInbound: null, template })).toBe("template");
  expect(messagePolicy({ ...base, lastInbound: null, template: { verifiedAt: new Date(0) } })).toBe(
    "suppress",
  );
  expect(messagePolicy({ ...base, status: "closed" })).toBe("suppress");
  expect(messagePolicy({ ...base, status: "owner" })).toBe("suppress");
  expect(messagePolicy({ ...base, status: "owner", allowOwner: true })).toBe("text");
  expect(messagePolicy({ ...base, lastInbound: new Date(now.getTime() + 1) })).toBe("suppress");
});
