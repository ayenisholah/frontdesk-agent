import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
it("fails disabled deployment and malformed preflight before contacting providers", () => {
  for (const script of ["deploy", "preflight"]) {
    try {
      execFileSync(process.execPath, ["--import", "tsx", `infra/bin/${script}.ts`], {
        env: { ...process.env, DEPLOY_ENABLED: "false", RELEASE_SHA: "private-invalid-input" },
        stdio: "pipe",
      });
      throw new Error("Expected failure");
    } catch (error) {
      const result = error as { status: number; stderr: Buffer };
      expect(result.status).toBe(1);
      expect(result.stderr.toString()).not.toContain("private-invalid-input");
      expect(result.stderr.toString()).toContain(
        script === "deploy" ? "Deployment failed." : "Release source verification failed.",
      );
    }
  }
});
