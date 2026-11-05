import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/log.js";

const capture = () => ({
  out: vi.spyOn(process.stdout, "write").mockReturnValue(true),
  err: vi.spyOn(process.stderr, "write").mockReturnValue(true),
});

describe("createLogger", () => {
  it("writes info as one JSON line to stdout with base and call fields", () => {
    const { out, err } = capture();
    createLogger("info", { service: "api" }).info("hello", { port: 1 });

    expect(err).not.toHaveBeenCalled();
    expect(JSON.parse(String(out.mock.calls[0]![0]))).toMatchObject({
      level: "info",
      msg: "hello",
      service: "api",
      port: 1,
    });
  });

  it.each(["warn", "error"] as const)("writes %s to stderr", (level) => {
    const { out, err } = capture();
    createLogger("debug")[level]("problem");

    expect(out).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledOnce();
  });

  it("drops messages below the minimum level", () => {
    const { out, err } = capture();
    createLogger("warn").info("quiet");

    expect(out).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });

  it("defaults to the info level", () => {
    const { out } = capture();
    const log = createLogger();
    log.debug("quiet");
    log.info("loud");

    expect(out).toHaveBeenCalledOnce();
  });
});
