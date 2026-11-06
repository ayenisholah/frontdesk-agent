import { DescribeStacksCommand, UpdateStackCommand } from "@aws-sdk/client-cloudformation";
import type { DeploymentConfig } from "./config";
import type { Parameters } from "./types";
import { parseStack, type StackData } from "./stack-data";
import { poll } from "./poll";
type Command = DescribeStacksCommand | UpdateStackCommand;
const stable = new Set(["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"]);
export function createStackAdapter(
  send: (command: Command) => Promise<unknown>,
  config: DeploymentConfig,
  wait: () => Promise<void>,
) {
  const read = async () =>
    parseStack(await send(new DescribeStacksCommand({ StackName: config.stack })));
  let operation = 0;
  return {
    read,
    inspect: async () => {
      const stack = await read();
      if (!stable.has(stack.status)) throw new Error("Runtime stack is not stable");
      return stack.snapshot;
    },
    update: async (parameters: Parameters) => {
      const stack = await read();
      if (!stable.has(stack.status)) throw new Error("Runtime stack is not stable");
      if (
        Object.entries(parameters).every(([key, value]) =>
          stack.parameters.some((p) => p.ParameterKey === key && p.ParameterValue === value),
        )
      )
        return;
      await send(
        new UpdateStackCommand({
          StackName: config.stack,
          UsePreviousTemplate: true,
          RoleARN: config.roleArn,
          Capabilities: ["CAPABILITY_IAM"],
          ClientRequestToken: `release-${config.requestId}-${++operation}`,
          Parameters: stack.parameters.map((p) => ({
            ParameterKey: p.ParameterKey,
            ...(parameters[p.ParameterKey as keyof Parameters] === undefined
              ? { UsePreviousValue: true }
              : { ParameterValue: parameters[p.ParameterKey as keyof Parameters] }),
          })),
        }),
      );
      await waitForUpdate(read, parameters, wait);
    },
  };
}

async function waitForUpdate(
  read: () => Promise<StackData>,
  parameters: Parameters,
  wait: () => Promise<void>,
) {
  await poll(
    async () => {
      const current = await read();
      if (current.status.endsWith("_IN_PROGRESS")) return false;
      if (current.status !== "UPDATE_COMPLETE") throw new Error("Stack update failed");
      return Object.entries(parameters).every(([key, value]) =>
        current.parameters.some((p) => p.ParameterKey === key && p.ParameterValue === value),
      );
    },
    wait,
    180,
  );
}
