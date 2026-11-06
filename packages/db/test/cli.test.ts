import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { baseUrl, useTestDatabase } from "./test-db";

describe.skipIf(!baseUrl)("CLI wiring", () => {
  const database = useTestDatabase();
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
