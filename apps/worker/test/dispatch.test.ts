import { describe, expect, it, vi } from "vitest";
import { dispatchInbox } from "../src/dispatch";

describe("inbox dispatcher", () => {
  it("publishes IDs only with stable deduplication and retries a failed publish", async () => {
    const row = { businessId: "fictional-business", sequence: "42" };
    const listDue = vi.fn().mockResolvedValue([row]);
    const add = vi.fn().mockRejectedValueOnce(new Error("Redis unavailable")).mockResolvedValue({});
    await expect(dispatchInbox({ listDue }, { add })).rejects.toThrow("Redis unavailable");
    expect(await dispatchInbox({ listDue }, { add })).toBe(1);
    expect(add).toHaveBeenLastCalledWith(
      "inbound",
      row,
      expect.objectContaining({ jobId: "inbound-42", removeOnComplete: true, removeOnFail: true }),
    );
    listDue.mockResolvedValue([]);
    expect(await dispatchInbox({ listDue }, { add })).toBe(0);
  });
});
