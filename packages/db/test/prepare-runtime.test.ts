import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
it("fails migration preparation without credentials and never prints secret inputs", () => {
  try {
    execFileSync(process.execPath, ["--import", "tsx", "packages/db/scripts/prepare-runtime.ts"], {
      env: {
        ...process.env,
        CLOUD_RUNTIME: "true",
        DATABASE_PASSWORD: "do-not-print-this",
        RUNTIME_DATABASE_PASSWORD: "",
      },
      stdio: "pipe",
    });
    throw new Error("Expected failure");
  } catch (error) {
    const result = error as { status: number; stderr: Buffer };
    expect(result.status).toBe(1);
    expect(result.stderr.toString()).toBe(
      "Database preparation failed. Check task configuration and database connectivity.\n",
    );
  }
});
