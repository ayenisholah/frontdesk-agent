import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShutdown } from "../src/lifecycle.js";
import { createLogger } from "../src/log.js";

const log = createLogger("error");

describe("createShutdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("drains the server, closes dependencies, then exits 0", async () => {
    const order: string[] = [];
    const exit = vi.fn(() => order.push("exit"));
    const shutdown = createShutdown({
      stopServer: (done) => {
        order.push("stop");
        done();
      },
      closeDependencies: async () => {
        order.push("close");
      },
      log,
      exit,
    });

    shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(0);

    expect(order).toEqual(["stop", "close", "exit"]);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("ignores a second signal", () => {
    const stopServer = vi.fn();
    const shutdown = createShutdown({
      stopServer,
      closeDependencies: async () => {},
      log,
      exit: vi.fn(),
    });

    shutdown("SIGTERM");
    shutdown("SIGINT");

    expect(stopServer).toHaveBeenCalledOnce();
  });

  it("force-exits 1 when draining outlasts the timeout", async () => {
    const exit = vi.fn();
    const shutdown = createShutdown({
      stopServer: () => {},
      closeDependencies: async () => {},
      log,
      exit,
      timeoutMs: 100,
    });

    shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(100);

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});
