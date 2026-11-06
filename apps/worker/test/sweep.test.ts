import { expect, it, vi } from "vitest";
import { createSweep } from "../src/sweep";
it("scopes every operation, drains retention batches, and stops between businesses", async () => {
  const controller = new AbortController();
  const dispatch = vi.fn().mockResolvedValue(undefined);
  const retain = vi
    .fn()
    .mockResolvedValueOnce({ messages: 100, runs: 0 })
    .mockResolvedValue({ messages: 0, runs: 0 });
  const sweep = createSweep({
    businesses: async () => ["a", "b"],
    dispatch,
    retain,
    signal: controller.signal,
  });
  await sweep.dispatch();
  expect(dispatch.mock.calls).toEqual([["a"], ["b"]]);
  await sweep.retain();
  expect(retain.mock.calls).toEqual([["a"], ["a"], ["b"]]);
  controller.abort();
  await sweep.dispatch();
  await sweep.retain();
  expect(dispatch).toHaveBeenCalledTimes(2);
  expect(retain).toHaveBeenCalledTimes(3);
});
it("drains full run batches and observes cancellation during cleanup", async () => {
  const controller = new AbortController();
  const retain = vi
    .fn()
    .mockResolvedValueOnce({ messages: 0, runs: 100 })
    .mockImplementation(async () => {
      controller.abort();
      return { messages: 100, runs: 100 };
    });
  const sweep = createSweep({
    businesses: async () => ["a"],
    dispatch: async () => {},
    retain,
    signal: controller.signal,
  });
  await sweep.retain();
  expect(retain).toHaveBeenCalledTimes(2);
});
