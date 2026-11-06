import { expect, it } from "vitest";
import { poll } from "../src/release/poll";
import { parseDeploymentConfig } from "../src/release/config";
import { createStackAdapter } from "../src/release/stack";
import { config, stackResponse } from "./release-fixture";
it("bounds polling and waits only for pending results", async () => {
  let count = 0,
    waits = 0;
  await poll(
    async () => ++count === 2,
    async () => {
      waits++;
    },
    2,
  );
  expect(waits).toBe(1);
  await expect(
    poll(
      async () => false,
      async () => {},
      1,
    ),
  ).rejects.toThrow("Polling timed out");
});
it("requires explicit enablement and matching scoped account/role configuration", () => {
  const env = {
    DEPLOY_ENABLED: "true",
    AWS_ACCOUNT_ID: config.account,
    AWS_DEPLOY_ROLE_ARN: "arn:aws:iam::111111111111:role/frontdesk-pilot-github-release",
    AWS_REGION: config.region,
    RUNTIME_STACK: config.stack,
    CLOUDFORMATION_ROLE_ARN: config.roleArn,
    GITHUB_RUN_ID: "1",
    GITHUB_RUN_ATTEMPT: "1",
  };
  expect(parseDeploymentConfig(env)).toEqual(config);
  for (const change of [
    { DEPLOY_ENABLED: "false" },
    { AWS_REGION: "us-east-1" },
    { AWS_DEPLOY_ROLE_ARN: "arn:aws:iam::222222222222:role/frontdesk-pilot-github-release" },
    { CLOUDFORMATION_ROLE_ARN: config.roleArn.replace(config.account, "222222222222") },
    { GITHUB_RUN_ID: "bad" },
  ])
    expect(() => parseDeploymentConfig({ ...env, ...change })).toThrow(
      "Invalid deployment configuration",
    );
});
it("uses the deployed template and preserves every unrelated parameter", async () => {
  const commands: object[] = [];
  const response = stackResponse();
  const adapter = createStackAdapter(
    async (c) => {
      commands.push(c);
      if (c.constructor.name === "UpdateStackCommand")
        response.Stacks[0]!.Parameters[1]!.ParameterValue = "b".repeat(40);
      return response;
    },
    config,
    async () => {},
  );
  expect((await adapter.inspect()).count).toBe(0);
  await adapter.update({ MigrationReleaseSha: "b".repeat(40) });
  expect(commands).toContainEqual(
    expect.objectContaining({
      input: expect.objectContaining({
        UsePreviousTemplate: true,
        RoleARN: config.roleArn,
        Parameters: expect.arrayContaining([
          { ParameterKey: "AppReleaseSha", UsePreviousValue: true },
          { ParameterKey: "MigrationReleaseSha", ParameterValue: "b".repeat(40) },
        ]) as unknown,
      }) as unknown,
    }),
  );
});
it("rejects unstable stacks and preserves no-op updates", async () => {
  const response = stackResponse();
  let updates = 0;
  const adapter = createStackAdapter(
    async (c) => {
      if (c.constructor.name === "UpdateStackCommand") updates++;
      return response;
    },
    config,
    async () => {},
  );
  await adapter.update({ AppReleaseSha: "a".repeat(40) });
  expect(updates).toBe(0);
  response.Stacks[0]!.StackStatus = "UPDATE_IN_PROGRESS";
  await expect(adapter.inspect()).rejects.toThrow("Runtime stack is not stable");
  await expect(adapter.update({ AppReleaseSha: "b".repeat(40) })).rejects.toThrow(
    "Runtime stack is not stable",
  );
});
it("waits through eventual consistency and rollback, then rejects failed stack updates", async () => {
  for (const fails of [false, true]) {
    let reads = 0,
      updating = false;
    const adapter = createStackAdapter(
      async (c) => {
        if (c.constructor.name === "UpdateStackCommand") {
          updating = true;
          return {};
        }
        const response = stackResponse();
        if (updating) {
          reads++;
          response.Stacks[0]!.StackStatus =
            reads === 1
              ? "UPDATE_IN_PROGRESS"
              : fails
                ? "UPDATE_ROLLBACK_COMPLETE"
                : "UPDATE_COMPLETE";
          if (reads > 2) response.Stacks[0]!.Parameters[0]!.ParameterValue = "b".repeat(40);
        }
        return response;
      },
      config,
      async () => {},
    );
    if (fails)
      await expect(adapter.update({ AppReleaseSha: "b".repeat(40) })).rejects.toThrow(
        "Stack update failed",
      );
    else await adapter.update({ AppReleaseSha: "b".repeat(40) });
  }
});
