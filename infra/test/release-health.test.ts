import { expect, it } from "vitest";
import { DescribeServicesCommand, ListTasksCommand } from "@aws-sdk/client-ecs";
import { createVerification } from "../src/release/verification";
import { parseStack } from "../src/release/stack-data";
import { stackResponse } from "./release-fixture";
it("requires the expected healthy revisions, target health and HTTPS release identity", async () => {
  const stack = parseStack(stackResponse());
  stack.snapshot.count = 1;
  const ecs = async (c: object) => {
    if (c instanceof DescribeServicesCommand)
      return {
        services: ["api", "worker"].map((name) => ({
          serviceName: name,
          desiredCount: 1,
          runningCount: 1,
          pendingCount: 0,
          taskDefinition:
            name === "api"
              ? stack.outputs.ApiTaskDefinitionArn
              : stack.outputs.WorkerTaskDefinitionArn,
          deployments: [{ rolloutState: "COMPLETED" }],
        })),
      };
    if (c instanceof ListTasksCommand) return { taskArns: [c.input.serviceName] };
    const name = (c as { input: { tasks: string[] } }).input.tasks[0];
    return {
      tasks: [
        {
          healthStatus: "HEALTHY",
          lastStatus: "RUNNING",
          taskDefinitionArn:
            name === "api"
              ? stack.outputs.ApiTaskDefinitionArn
              : stack.outputs.WorkerTaskDefinitionArn,
        },
      ],
    };
  };
  const verify = createVerification({
    ecs,
    targets: async () => ({ TargetHealthDescriptions: [{ TargetHealth: { State: "healthy" } }] }),
    request: async () => ({
      ok: true,
      json: async () => ({ status: "ok", release: "a".repeat(40) }),
    }),
    read: async () => stack,
    wait: async () => {},
  });
  await verify("a".repeat(40), 1);
  await expect(verify("b".repeat(40), 1)).rejects.toThrow("Unexpected deployed release");
});
