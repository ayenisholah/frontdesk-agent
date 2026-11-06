import { execFileSync, spawnSync } from "node:child_process";
import { assertReleaseEvidence, assertProductionProtection } from "../src/release/trust";
try {
  const sha = process.env.RELEASE_SHA;
  if (!sha || !/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid SHA");
  const api = (path: string): unknown =>
    JSON.parse(
      execFileSync("gh", ["api", `repos/ayenisholah/frontdesk-agent/${path}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
      }),
    );
  const runs = (workflow: string) =>
    api(
      `actions/workflows/${workflow}/runs?head_sha=${sha}&event=push&status=success&per_page=100`,
    );
  assertProductionProtection(
    api("environments/production"),
    api("environments/production/deployment-branch-policies?per_page=100"),
  );
  assertReleaseEvidence({
    ref: process.env.GITHUB_REF,
    sha,
    ancestor: spawnSync("git", ["merge-base", "--is-ancestor", sha, "origin/main"]).status === 0,
    ci: runs("ci.yml"),
    codeql: runs("codeql.yml"),
  });
  console.log("Release source verified.");
} catch {
  console.error("Release source verification failed.");
  process.exitCode = 1;
}
