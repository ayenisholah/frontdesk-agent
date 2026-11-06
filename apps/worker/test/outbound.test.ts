import { expect, it, vi } from "vitest";
import { createOutboundProcessor } from "../src/outbound";
const ref = { businessId: "b", id: "w" };
function fixture() {
  const store = {
    route: vi.fn().mockResolvedValue({ state: "pending", senderId: "s", recipientId: "r" }),
    defer: vi.fn().mockResolvedValue(undefined),
    begin: vi.fn().mockResolvedValue({ state: "send", attemptId: "a", sender: {}, message: {} }),
    resolve: vi.fn().mockResolvedValue(undefined),
  };
  const limit = vi.fn().mockResolvedValue(0);
  const send = vi.fn().mockResolvedValue({ state: "accepted", providerMessageId: "provider" });
  return {
    store,
    limit,
    send,
    process: createOutboundProcessor({ store: () => store, limit, send }),
  };
}
it("records explicit results and treats transport exceptions as uncertain", async () => {
  const f = fixture();
  await f.process(ref);
  expect(f.store.resolve).toHaveBeenCalledWith("a", {
    state: "accepted",
    providerMessageId: "provider",
  });
  f.send.mockRejectedValueOnce(new Error("private"));
  await f.process(ref);
  expect(f.store.resolve).toHaveBeenLastCalledWith("a", { state: "uncertain" });
});
it("defers rate-limited work without creating attempts and skips terminal work", async () => {
  const f = fixture();
  f.limit.mockResolvedValueOnce(6000);
  await f.process(ref);
  expect(f.store.defer).toHaveBeenCalledWith("w", 6000);
  expect(f.store.begin).not.toHaveBeenCalled();
  f.store.route.mockResolvedValueOnce(null);
  await f.process(ref);
  f.store.begin.mockResolvedValueOnce({ state: "skip" });
  f.store.route.mockResolvedValueOnce({ state: "sending", senderId: "s", recipientId: "r" });
  await f.process(ref);
  expect(f.send).not.toHaveBeenCalled();
  expect(f.limit).toHaveBeenCalledOnce();
});
