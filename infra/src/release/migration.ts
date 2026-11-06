import { RunTaskCommand, DescribeTasksCommand, StopTaskCommand } from "@aws-sdk/client-ecs";
import { z } from "zod";
import type { DeploymentConfig } from "./config";
import type { StackData } from "./stack-data";
import { poll, PollTimeout } from "./poll";
const launch = z.object({
  failures: z.array(z.unknown()).default([]),
  tasks: z.array(z.object({ taskArn: z.string() })).default([]),
});
const status = z.object({
  failures: z.array(z.unknown()).default([]),
  tasks: z
    .array(
      z.object({
        lastStatus: z.string(),
        containers: z
          .array(z.object({ name: z.string(), exitCode: z.number().optional() }))
          .default([]),
      }),
    )
    .default([]),
});
type Command = RunTaskCommand | DescribeTasksCommand | StopTaskCommand;
export function createMigration(
  send: (c: Command) => Promise<unknown>,
  read: () => Promise<StackData>,
  config: DeploymentConfig,
  wait: () => Promise<void>,
) {
  return async (record: (arn: string) => void) => {
    const { outputs } = await read();
    const result = launch.parse(
      await send(
        new RunTaskCommand({
          cluster: outputs.ClusterArn,
          taskDefinition: outputs.MigrationTaskDefinitionArn,
          launchType: "FARGATE",
          count: 1,
          clientToken: `migration-${config.requestId}`,
          networkConfiguration: {
            awsvpcConfiguration: {
              subnets: outputs.ApplicationSubnetIds.split(","),
              securityGroups: [outputs.MigrationSecurityGroupId],
              assignPublicIp: "DISABLED",
            },
          },
        }),
      ),
    );
    if (result.failures.length || result.tasks.length !== 1)
      throw new Error("Migration task launch failed");
    const arn = result.tasks[0]!.taskArn;
    record(arn);
    try {
      await poll(() => migrationFinished(send, outputs.ClusterArn, arn), wait, 120);
    } catch (error) {
      if (error instanceof PollTimeout)
        await send(
          new StopTaskCommand({
            cluster: outputs.ClusterArn,
            task: arn,
            reason: "Migration deadline exceeded; investigate before retry",
          }),
        );
      throw new Error("Migration did not complete successfully", { cause: error });
    }
  };
}

async function migrationFinished(
  send: (c: Command) => Promise<unknown>,
  cluster: string,
  arn: string,
) {
  const result = status.parse(await send(new DescribeTasksCommand({ cluster, tasks: [arn] })));
  if (result.failures.length) throw new Error("Migration task unavailable");
  const task = result.tasks[0];
  if (!task || task.lastStatus !== "STOPPED") return false;
  if (
    task.containers.length !== 1 ||
    task.containers[0]!.name !== "migrate" ||
    task.containers[0]!.exitCode !== 0
  )
    throw new Error("Migration task failed");
  return true;
}
