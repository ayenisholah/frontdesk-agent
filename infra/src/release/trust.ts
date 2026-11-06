import { z } from "zod";
const run = z.object({
  head_sha: z.string(),
  head_branch: z.string(),
  event: z.string(),
  conclusion: z.string(),
});
const evidence = z.object({
  ref: z.literal("refs/heads/main"),
  sha: z.string().regex(/^[a-f0-9]{40}$/),
  ancestor: z.literal(true),
  ci: z.object({ workflow_runs: z.array(run) }),
  codeql: z.object({ workflow_runs: z.array(run) }),
});
export function assertReleaseEvidence(input: unknown) {
  const result = evidence.safeParse(input);
  if (!result.success) throw new Error("Release is not verified on main");
  const data = result.data;
  if (
    ![data.ci, data.codeql].every((e) =>
      e.workflow_runs.some(
        (r) =>
          r.head_sha === data.sha &&
          r.head_branch === "main" &&
          r.event === "push" &&
          r.conclusion === "success",
      ),
    )
  )
    throw new Error("Release is not verified on main");
}
export function assertAccount(input: unknown, account: string) {
  if (!z.object({ Account: z.literal(account) }).safeParse(input).success)
    throw new Error("Unexpected AWS account");
}
const protection = z.object({
  protection_rules: z.array(
    z.object({ type: z.string(), reviewers: z.array(z.unknown()).optional() }),
  ),
  deployment_branch_policy: z.object({
    custom_branch_policies: z.literal(true),
    protected_branches: z.literal(false),
  }),
});
const branchRules = z.object({
  total_count: z.literal(1),
  branch_policies: z
    .array(z.object({ name: z.literal("main"), type: z.literal("branch").default("branch") }))
    .length(1),
});
export function assertProductionProtection(environment: unknown, branches: unknown) {
  const parsed = protection.safeParse(environment);
  if (!parsed.success || !branchRules.safeParse(branches).success)
    throw new Error("Production protection is incomplete");
  if (
    !parsed.data.protection_rules.some(
      (r) => r.type === "required_reviewers" && (r.reviewers?.length ?? 0) > 0,
    )
  )
    throw new Error("Production protection is incomplete");
}
