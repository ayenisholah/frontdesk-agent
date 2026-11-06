import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { baseUrl, useTestDatabase } from "./test-db";

describe.skipIf(!baseUrl)("CLI wiring", () => {
  const database = useTestDatabase();
  it("refuses nonlocal demo dependencies before creating fixtures", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/whatsapp-demo.ts"], {
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, DATABASE_URL: "postgresql://private:secret@production.invalid/db" },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe('{"event":"fictional_demo_failed"}\n');
  });
  it.skipIf(!process.env.REDIS_URL)(
    "runs the signed webhook demo with explicit fake providers and removes its fictional tenant",
    async () => {
      const before = await database.db().business.count();
      const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/whatsapp-demo.ts"], {
        encoding: "utf8",
        timeout: 25_000,
        env: { ...process.env, DATABASE_URL: database.url(), AWS_REGION: "", BEDROCK_MODEL_ID: "" },
      });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        mode: "fictional",
        inbound: 1,
        replies: 1,
        delivery: "delivered",
      });
      expect(await database.db().business.count()).toBe(before);
    },
    30_000,
  );
  const rates = {
    version: "smoke-no-inference",
    models: { "eu.fixture": { inputMicrosPerToken: 1, outputMicrosPerToken: 1 } },
  };
  function chat(args: string[] = []) {
    return spawnSync(process.execPath, ["--import", "tsx", "scripts/chat.ts", ...args], {
      input: ":quit\n",
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        DATABASE_URL: database.url(),
        AWS_REGION: "eu-west-1",
        BEDROCK_MODEL_ID: "eu.fixture",
        BEDROCK_MODEL_ID_SMALL: "eu.fixture",
        BEDROCK_RATES: JSON.stringify(rates),
      },
    });
  }
  it("accepts piped input after database setup and resumes the session without inference", () => {
    const first = chat();
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    const id = /Fictional chat session: ([a-f0-9-]+)/.exec(first.stdout)![1]!;
    const resumed = chat(["--conversation", id]);
    expect(resumed.status).toBe(0);
    expect(resumed.stdout).toContain(id);
  }, 35_000);
});
