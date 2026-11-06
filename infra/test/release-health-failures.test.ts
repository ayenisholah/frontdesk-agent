import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { DescribeServicesCommand, ListTasksCommand } from "@aws-sdk/client-ecs";
import { expect, it } from "vitest";
import { createVerification } from "../src/release/verification";
import { parseStack } from "../src/release/stack-data";
import { stackResponse } from "./release-fixture";
function fixture(mode: string, count: 0 | 1 = 1) {
  const stack = parseStack(stackResponse());
  stack.snapshot.count = count;
  const request = async () => {
    if (mode === "http-error") throw new Error("unavailable");
    return {
      ok: mode !== "http-status",
      json: async () => ({
        status: "ok",
        release: mode === "http-release" ? "wrong" : "a".repeat(40),
      }),
    };
  };
  const ecs = async (c: object) => {
    if (c instanceof DescribeServicesCommand) {
      const services = ["api", "worker"].map((name) => ({
        serviceName: name,
        desiredCount: count,
        runningCount: count,
        pendingCount: 0,
        taskDefinition:
          name === "api"
            ? stack.outputs.ApiTaskDefinitionArn
            : stack.outputs.WorkerTaskDefinitionArn,
        deployments: [{ rolloutState: "COMPLETED" }],
      }));
      if (mode === "service-revision") services[0]!.taskDefinition = "other";
      if (mode === "desired") services[0]!.desiredCount = 0;
      if (mode === "running") services[0]!.runningCount = 0;
      if (mode === "pending") services[0]!.pendingCount = 1;
      if (mode === "deployments") services[0]!.deployments = [];
      if (mode === "rollout") services[0]!.deployments[0]!.rolloutState = "IN_PROGRESS";
      if (mode === "duplicate") services[1]!.serviceName = "api";
      return {
        failures: mode === "service-failure" ? [{}] : [],
        services: mode === "missing-service" ? [] : services,
      };
    }
    if (c instanceof ListTasksCommand)
      return { taskArns: mode === "missing-list" ? [] : [c.input.serviceName] };
    const name = (c as { input: { tasks: string[] } }).input.tasks[0];
    return {
      failures: mode === "task-failure" ? [{}] : [],
      tasks:
        mode === "missing-task"
          ? []
          : [
              {
                healthStatus: mode === "health" ? "UNHEALTHY" : "HEALTHY",
                lastStatus: mode === "stopped" ? "STOPPED" : "RUNNING",
                taskDefinitionArn:
                  mode === "task-revision"
                    ? "other"
                    : name === "api"
                      ? stack.outputs.ApiTaskDefinitionArn
                      : stack.outputs.WorkerTaskDefinitionArn,
              },
            ],
    };
  };
  return {
    ecs,
    request,
    read: async () => stack,
    wait: async () => {},
    targets: async () => ({
      TargetHealthDescriptions:
        mode === "missing-target"
          ? []
          : [{ TargetHealth: { State: mode === "unhealthy-target" ? "unhealthy" : "healthy" } }],
    }),
  };
}
it("fails verification for incomplete services, tasks, targets or readiness", async () => {
  for (const mode of [
    "service-revision",
    "desired",
    "running",
    "pending",
    "deployments",
    "rollout",
    "duplicate",
    "service-failure",
    "missing-service",
    "missing-list",
    "task-failure",
    "missing-task",
    "health",
    "stopped",
    "task-revision",
    "missing-target",
    "unhealthy-target",
    "http-error",
    "http-status",
    "http-release",
  ]) {
    await expect(createVerification(fixture(mode))("a".repeat(40), 1)).rejects.toThrow(
      "Polling timed out",
    );
  }
});
it("verifies zero-task recovery without calling HTTP and rejects unexpected desired counts", async () => {
  const ports = fixture("normal", 0);
  ports.request = async () => {
    throw new Error("Must not contact endpoint");
  };
  await createVerification(ports)("a".repeat(40), 0);
  await expect(createVerification(ports)("a".repeat(40), 1)).rejects.toThrow(
    "Unexpected deployed release",
  );
});
it("validates readiness responses from a real local HTTP server", async () => {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ status: "ok", release: "a".repeat(40) }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const ports = fixture("normal");
  try {
    await createVerification({
      ...ports,
      request: async (url) => {
        expect(url).toBe("https://frontdesk.example.com/readyz");
        return fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/readyz`);
      },
    })("a".repeat(40), 1);
  } finally {
    server.close();
    await once(server, "close");
  }
});
