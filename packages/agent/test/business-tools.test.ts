import { harborPaws } from "@frontdesk/core";
import { describe, expect, it, vi } from "vitest";
import { createBusinessTools, type BusinessContext, type ToolStore } from "../src/index";
import { runTool } from "../src/tools";

const now = new Date("2031-03-03T08:00:00Z");
function setup() {
  const store: ToolStore = {
    availability: vi.fn(async () => [
      { startsAt: "2031-03-03T10:00:00.000Z", endsAt: "2031-03-03T11:00:00.000Z" },
    ]),
    hold: vi.fn(async () => ({
      ok: true as const,
      hold: {
        id: "h",
        startsAt: "2031-03-03T10:00:00.000Z",
        endsAt: "2031-03-03T11:00:00.000Z",
        expiresAt: "2031-03-03T08:15:00.000Z",
      },
    })),
    handoff: vi.fn(async () => undefined),
  };
  const context: BusinessContext = { config: harborPaws, store, runId: "run", now: () => now };
  const tools = createBusinessTools();
  const call = (name: string, input: unknown = {}) =>
    runTool(tools, { id: "call", name, input }, context);
  return { store, call, context };
}

describe("business tools", () => {
  it("renders only configured services and amounts", async () => {
    const { call } = setup();
    const result = await call("get_services");
    expect(result.content).toMatchObject({
      reply: expect.stringContaining(harborPaws.services[0]!.name) as unknown,
    });
    expect((await call("get_services", { price: 0 })).isError).toBe(true);
  });
  it("offers engine results and handles no availability", async () => {
    const { call, store } = setup();
    const input = {
      serviceKey: harborPaws.services[0]!.id,
      from: now.toISOString(),
      to: "2031-03-04T08:00:00Z",
    };
    expect((await call("check_availability", input)).content).toMatchObject({
      reply: expect.stringContaining("2031") as unknown,
    });
    vi.mocked(store.availability).mockResolvedValue([]);
    expect((await call("check_availability", input)).content).toMatchObject({ failed: true });
    expect(
      (await call("check_availability", { ...input, to: "2032-03-04T08:00:00Z" })).isError,
    ).toBe(true);
    expect(
      (await call("check_availability", { ...input, to: "2030-01-01T00:00:00Z" })).isError,
    ).toBe(true);
    expect(
      (await call("check_availability", { ...input, serviceKey: "missing" })).content,
    ).toMatchObject({ failed: true });
  });
  it("holds through the store and never accepts identity or prices", async () => {
    const { call, store } = setup();
    const input = { serviceKey: harborPaws.services[0]!.id, startsAt: "2031-03-03T10:00:00Z" };
    expect((await call("hold_slot", input)).content).toMatchObject({
      reply: expect.stringContaining("not a confirmed booking") as unknown,
    });
    expect(store.hold).toHaveBeenCalledWith("run", "call", input);
    expect((await call("hold_slot", { ...input, businessId: "other" })).isError).toBe(true);
    vi.mocked(store.hold).mockResolvedValue({ ok: false, reason: "slot_unavailable" });
    expect((await call("hold_slot", input)).content).toMatchObject({ failed: true });
    expect((await call("hold_slot", { ...input, serviceKey: "missing" })).content).toMatchObject({
      failed: true,
    });
  });
  it("returns an indexed configured FAQ, handing off when unsupported", async () => {
    const { call, store } = setup();
    expect((await call("answer_faq", { index: 0 })).content).toMatchObject({
      reply: harborPaws.faq[0]!.answer,
    });
    expect((await call("answer_faq", { index: null })).content).toMatchObject({
      handoff: "unknown_question",
    });
    expect((await call("answer_faq", { index: 999 })).content).toMatchObject({
      handoff: "unknown_question",
    });
    expect(store.handoff).toHaveBeenCalled();
  });
  it("records a terminal handoff without trusting model-written summaries", async () => {
    const { call, store } = setup();
    expect((await call("handoff_to_owner", { reason: "refund" })).content).toMatchObject({
      handoff: "refund",
    });
    expect(store.handoff).toHaveBeenCalledWith("run", "call", "refund");
    expect((await call("handoff_to_owner", { reason: "anything" })).isError).toBe(true);
  });
});
