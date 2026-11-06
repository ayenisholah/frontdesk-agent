import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { expect, it } from "vitest";
const gate = z.object({
  on: z.object({ workflow_dispatch: z.unknown() }).strict(),
  concurrency: z.object({
    group: z.literal("frontdesk-production-release"),
    "cancel-in-progress": z.literal(false),
  }),
  jobs: z.object({
    deploy: z.object({
      if: z.string().includes("refs/heads/main").includes("AWS_DEPLOY_ENABLED == 'true'"),
      environment: z.literal("production"),
      permissions: z
        .object({
          contents: z.literal("read"),
          actions: z.literal("read"),
          "id-token": z.literal("write"),
        })
        .strict(),
      steps: z.array(
        z.object({
          uses: z
            .string()
            .regex(/^[a-zA-Z0-9_./-]+@[a-f0-9]{40}$/)
            .optional(),
        }),
      ),
    }),
  }),
});
it("keeps deployment manual, disabled by default, approved and serialized with pinned actions", () => {
  const workflow: unknown = parse(
    readFileSync(new URL("../../.github/workflows/deploy.yml", import.meta.url), "utf8"),
  );
  const checked = gate.parse(workflow);
  expect(() => gate.parse({ ...checked, on: { pull_request_target: {} } })).toThrow();
  expect(() =>
    gate.parse({ ...checked, jobs: { deploy: { ...checked.jobs.deploy, if: "true" } } }),
  ).toThrow();
  expect(() =>
    gate.parse({
      ...checked,
      jobs: { deploy: { ...checked.jobs.deploy, environment: "unprotected" } },
    }),
  ).toThrow();
});
