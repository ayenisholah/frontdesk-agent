import { expect, it } from "vitest";
import { assertReleaseEvidence, assertAccount } from "../src/release/trust";
const sha = "a".repeat(40);
const success = {
  workflow_runs: [{ head_sha: sha, head_branch: "main", event: "push", conclusion: "success" }],
};
it("rejects planted untrusted branches, SHAs and unsuccessful CI evidence", () => {
  const valid = { ref: "refs/heads/main", sha, ancestor: true, ci: success, codeql: success };
  expect(() => assertReleaseEvidence(valid)).not.toThrow();
  for (const change of [
    { ref: "refs/pull/1/merge" },
    { sha: "bad" },
    { ancestor: false },
    { ci: { workflow_runs: [] } },
    { codeql: { workflow_runs: [{ ...success.workflow_runs[0], head_sha: "b".repeat(40) }] } },
  ])
    expect(() => assertReleaseEvidence({ ...valid, ...change })).toThrow(
      "Release is not verified on main",
    );
  expect(() => assertAccount({ Account: "111111111111" }, "111111111111")).not.toThrow();
  expect(() => assertAccount({ Account: "222222222222" }, "111111111111")).toThrow(
    "Unexpected AWS account",
  );
});
it("rejects missing approval rules and broadened production branch policies", async () => {
  const { assertProductionProtection } = await import("../src/release/trust");
  const environment = {
    protection_rules: [{ type: "required_reviewers", reviewers: [{}] }],
    deployment_branch_policy: { custom_branch_policies: true, protected_branches: false },
  };
  const branches = { total_count: 1, branch_policies: [{ name: "main", type: "branch" }] };
  expect(() => assertProductionProtection(environment, branches)).not.toThrow();
  expect(() => assertProductionProtection({}, branches)).toThrow(
    "Production protection is incomplete",
  );
  for (const rule of [
    { type: "wait_timer" },
    { type: "required_reviewers" },
    { type: "required_reviewers", reviewers: [] },
  ])
    expect(() =>
      assertProductionProtection({ ...environment, protection_rules: [rule] }, branches),
    ).toThrow("Production protection is incomplete");
  expect(() => assertProductionProtection(environment, { ...branches, total_count: 2 })).toThrow(
    "Production protection is incomplete",
  );
  expect(() =>
    assertProductionProtection(environment, {
      ...branches,
      branch_policies: [{ name: "*", type: "tag" }],
    }),
  ).toThrow("Production protection is incomplete");
});
