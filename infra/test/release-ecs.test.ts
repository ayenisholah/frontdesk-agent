import { expect, it } from "vitest";
import { RunTaskCommand, DescribeTasksCommand, StopTaskCommand } from "@aws-sdk/client-ecs";
import { createMigration } from "../src/release/migration";
import { parseStack } from "../src/release/stack-data";
import { config, stackResponse } from "./release-fixture";
it("runs the private migration and requires a zero exit code", async () => {
  let recorded = "";
  const run = createMigration(
    async (c) => {
      if (c instanceof RunTaskCommand) {
        expect(c.input.networkConfiguration?.awsvpcConfiguration?.assignPublicIp).toBe("DISABLED");
        return { tasks: [{ taskArn: "task-1" }] };
      }
      expect(c).toBeInstanceOf(DescribeTasksCommand);
      return { tasks: [{ lastStatus: "STOPPED", containers: [{ name: "migrate", exitCode: 0 }] }] };
    },
    async () => parseStack(stackResponse()),
    config,
    async () => {},
  );
  await run((arn) => {
    recorded = arn;
  });
  expect(recorded).toBe("task-1");
});
it("blocks failed launches, failed containers and stops timed-out tasks", async () => {
  for (const mode of ["launch", "exit", "timeout"]) {
    let stopped = false;
    const run = createMigration(
      async (c) => {
        if (c instanceof RunTaskCommand)
          return mode === "launch" ? { failures: [{}] } : { tasks: [{ taskArn: "task-1" }] };
        if (c instanceof StopTaskCommand) {
          stopped = true;
          return {};
        }
        return {
          tasks: [
            {
              lastStatus: mode === "timeout" ? "RUNNING" : "STOPPED",
              containers: [{ name: "migrate", exitCode: 1 }],
            },
          ],
        };
      },
      async () => parseStack(stackResponse()),
      config,
      async () => {},
    );
    await expect(run(() => {})).rejects.toThrow();
    expect(stopped).toBe(mode === "timeout");
  }
});
it("rejects missing launches and incomplete or uninspectable stopped tasks", async () => {
  const states = [
    { failures: [{}] },
    { tasks: [{ lastStatus: "STOPPED", containers: [] }] },
    { tasks: [{ lastStatus: "STOPPED", containers: [{ name: "other", exitCode: 0 }] }] },
    { tasks: [{ lastStatus: "STOPPED", containers: [{ name: "migrate" }] }] },
  ];
  for (const state of states) {
    let first = true;
    const run = createMigration(
      async (c) => {
        if (c instanceof RunTaskCommand) return { tasks: [{ taskArn: "task-1" }] };
        if (first) {
          first = false;
          return { tasks: [] };
        }
        return state;
      },
      async () => parseStack(stackResponse()),
      config,
      async () => {},
    );
    await expect(run(() => {})).rejects.toThrow("Migration did not complete successfully");
  }
  const run = createMigration(
    async () => ({}),
    async () => parseStack(stackResponse()),
    config,
    async () => {},
  );
  await expect(run(() => {})).rejects.toThrow("Migration task launch failed");
});
