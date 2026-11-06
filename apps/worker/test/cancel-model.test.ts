import { expect, it, vi } from "vitest";
import { cancelModel } from "../src/cancel-model";
const request = { system: "test", messages: [], tools: [], maxTokens: 1 };
it("forwards cancellation and bounds providers that ignore abort", async () => {
  const controller = new AbortController();
  const complete = vi.fn(() => new Promise<never>(() => {}));
  const model = cancelModel({ complete }, controller.signal);
  const pending = model.complete(request);
  controller.abort();
  await expect(pending).rejects.toThrow("Model timeout");
  expect(complete).toHaveBeenCalledWith({ ...request, signal: controller.signal });
  await expect(model.complete(request)).rejects.toThrow("Model timeout");
  expect(complete).toHaveBeenCalledOnce();
});
it("preserves successful results and failures", async () => {
  const signal = new AbortController().signal;
  const result = { text: "reply", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
  const complete = vi.fn().mockResolvedValueOnce(result).mockRejectedValueOnce(new Error("failed"));
  const model = cancelModel({ complete }, signal);
  expect(await model.complete(request)).toBe(result);
  await expect(model.complete(request)).rejects.toThrow("failed");
});
