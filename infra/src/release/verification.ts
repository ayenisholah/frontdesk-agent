import {
  DescribeServicesCommand,
  ListTasksCommand,
  DescribeTasksCommand,
} from "@aws-sdk/client-ecs";
import { DescribeTargetHealthCommand } from "@aws-sdk/client-elastic-load-balancing-v2";
import { z } from "zod";
import { poll } from "./poll";
import type { StackData } from "./stack-data";
type EcsCommand = DescribeServicesCommand | ListTasksCommand | DescribeTasksCommand;
type Ports = {
  ecs: (c: EcsCommand) => Promise<unknown>;
  targets: (c: DescribeTargetHealthCommand) => Promise<unknown>;
  request: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
  read: () => Promise<StackData>;
  wait: () => Promise<void>;
};
const services = z.object({
  failures: z.array(z.unknown()).default([]),
  services: z
    .array(
      z.object({
        serviceName: z.string(),
        desiredCount: z.number(),
        runningCount: z.number(),
        pendingCount: z.number(),
        taskDefinition: z.string(),
        deployments: z.array(z.object({ rolloutState: z.string().optional() })),
      }),
    )
    .default([]),
});
const tasks = z.object({
  failures: z.array(z.unknown()).default([]),
  tasks: z
    .array(
      z.object({ healthStatus: z.string(), lastStatus: z.string(), taskDefinitionArn: z.string() }),
    )
    .default([]),
});
const targets = z.object({
  TargetHealthDescriptions: z
    .array(z.object({ TargetHealth: z.object({ State: z.string() }) }))
    .default([]),
});
export function createVerification(ports: Ports) {
  return async (sha: string, count: 0 | 1) => {
    const { outputs, snapshot } = await ports.read();
    if (snapshot.app !== sha || snapshot.count !== count)
      throw new Error("Unexpected deployed release");
    await poll(
      async () => {
        if (!(await healthyServices(ports, outputs, count))) return false;
        if (count === 0) return true;
        const result = targets.parse(
          await ports.targets(
            new DescribeTargetHealthCommand({ TargetGroupArn: outputs.TargetGroupArn }),
          ),
        );
        if (
          !result.TargetHealthDescriptions.length ||
          !result.TargetHealthDescriptions.every((t) => t.TargetHealth.State === "healthy")
        )
          return false;
        return ready(ports.request, outputs.ApiEndpoint, sha);
      },
      ports.wait,
      180,
    );
  };
}
async function healthyServices(ports: Ports, o: StackData["outputs"], count: number) {
  const expected = new Map([
    [o.ApiServiceName, o.ApiTaskDefinitionArn],
    [o.WorkerServiceName, o.WorkerTaskDefinitionArn],
  ]);
  const result = services.parse(
    await ports.ecs(
      new DescribeServicesCommand({ cluster: o.ClusterArn, services: [...expected.keys()] }),
    ),
  );
  if (result.failures.length || new Set(result.services.map((s) => s.serviceName)).size !== 2)
    return false;
  for (const s of result.services) {
    if (!serviceMatches(s, expected.get(s.serviceName), count)) return false;
    if (count === 0) continue;
    if (s.deployments.length !== 1 || s.deployments[0]!.rolloutState !== "COMPLETED") return false;
    if (!(await healthyTasks(ports, o.ClusterArn, s, count))) return false;
  }
  return true;
}
async function ready(request: Ports["request"], endpoint: string, sha: string) {
  try {
    const response = await request(`${endpoint}/readyz`);
    const result = z
      .object({ status: z.literal("ok"), release: z.literal(sha) })
      .safeParse(await response.json());
    return response.ok && result.success;
  } catch {
    return false;
  }
}

function serviceMatches(
  s: z.infer<typeof services>["services"][number],
  expected: string | undefined,
  count: number,
) {
  return (
    s.taskDefinition === expected &&
    s.desiredCount === count &&
    s.runningCount === count &&
    s.pendingCount === 0
  );
}
async function healthyTasks(
  ports: Ports,
  cluster: string,
  s: z.infer<typeof services>["services"][number],
  count: number,
) {
  const listed = z.object({ taskArns: z.array(z.string()).default([]) }).parse(
    await ports.ecs(
      new ListTasksCommand({
        cluster: cluster,
        serviceName: s.serviceName,
        desiredStatus: "RUNNING",
      }),
    ),
  );
  if (listed.taskArns.length !== count) return false;
  const running = tasks.parse(
    await ports.ecs(new DescribeTasksCommand({ cluster: cluster, tasks: listed.taskArns })),
  );
  if (
    running.failures.length ||
    running.tasks.length !== count ||
    !running.tasks.every(
      (t) =>
        t.healthStatus === "HEALTHY" &&
        t.lastStatus === "RUNNING" &&
        t.taskDefinitionArn === s.taskDefinition,
    )
  )
    return false;
  return true;
}
