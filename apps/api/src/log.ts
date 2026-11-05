// Structured JSON logs. Never pass message bodies, phone numbers or secrets in fields (NFR-5).
type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type Logger = Record<Level, (msg: string, fields?: Record<string, unknown>) => void>;

export function createLogger(min: Level = "info", base: Record<string, unknown> = {}): Logger {
  const emit =
    (level: Level) =>
    (msg: string, fields: Record<string, unknown> = {}) => {
      if (order[level] < order[min]) return;
      const line = JSON.stringify({
        time: new Date().toISOString(),
        level,
        msg,
        ...base,
        ...fields,
      });
      (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
    };
  return { debug: emit("debug"), info: emit("info"), warn: emit("warn"), error: emit("error") };
}
