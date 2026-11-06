import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import {
  ECSClient,
  RunTaskCommand,
  StopTaskCommand,
  DescribeServicesCommand,
  ListTasksCommand,
} from "@aws-sdk/client-ecs";
import { ECRClient, DescribeImagesCommand, DescribeRepositoriesCommand } from "@aws-sdk/client-ecr";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { ElasticLoadBalancingV2Client } from "@aws-sdk/client-elastic-load-balancing-v2";
import { parseDeploymentConfig } from "../src/release/config";
import { assertAccount } from "../src/release/trust";
import { createStackAdapter } from "../src/release/stack";
import { createMigration } from "../src/release/migration";
import { createPublisher } from "../src/release/images";
import { createVerification } from "../src/release/verification";
import { runRelease, recoverRelease } from "../src/release/runner";
import type { Manifest } from "../src/release/types";
async function main() {
  const config = parseDeploymentConfig(process.env);
  const options = {
    region: config.region,
    maxAttempts: 2,
    requestHandler: { requestTimeout: 10_000, connectionTimeout: 5_000 },
  };
  assertAccount(
    await new STSClient(options).send(new GetCallerIdentityCommand({})),
    config.account,
  );
  const cfn = new CloudFormationClient(options),
    ecs = new ECSClient(options),
    ecr = new ECRClient(options),
    elb = new ElasticLoadBalancingV2Client(options);
  const wait = async () => {
    await setTimeout(5_000);
  };
  const stack = createStackAdapter(
    (c) => (c instanceof DescribeStacksCommand ? cfn.send(c) : cfn.send(c)),
    config,
    wait,
  );
  const ports = {
    target: `${config.account}/${config.stack}`,
    inspect: stack.inspect,
    update: stack.update,
    publish: createPublisher({
      config,
      read: stack.read,
      send: (c) =>
        c instanceof DescribeImagesCommand
          ? ecr.send(c)
          : c instanceof DescribeRepositoriesCommand
            ? ecr.send(c)
            : ecr.send(c),
      docker: (args, input) =>
        Promise.resolve(
          execFileSync("docker", args, {
            input,
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 600_000,
            maxBuffer: 16 * 1024 * 1024,
          }),
        ),
    }),
    migrate: createMigration(
      (c) =>
        c instanceof RunTaskCommand
          ? ecs.send(c)
          : c instanceof StopTaskCommand
            ? ecs.send(c)
            : ecs.send(c),
      stack.read,
      config,
      wait,
    ),
    verify: createVerification({
      ecs: (c) =>
        c instanceof DescribeServicesCommand
          ? ecs.send(c)
          : c instanceof ListTasksCommand
            ? ecs.send(c)
            : ecs.send(c),
      targets: (c) => elb.send(c),
      read: stack.read,
      wait,
      request: (url) => fetch(url, { signal: AbortSignal.timeout(5_000), redirect: "error" }),
    }),
    record: (report: Manifest) => {
      mkdirSync("artifacts", { recursive: true });
      writeFileSync("artifacts/release.json", JSON.stringify(report, null, 2) + "\n");
    },
  };
  const report =
    process.argv[2] === "--recover"
      ? await recoverRelease(JSON.parse(readFileSync(process.argv[3]!, "utf8")), ports)
      : await runRelease(process.env.RELEASE_SHA ?? "", ports);
  console.log(JSON.stringify({ status: report.status, release: report.sha }));
  if (!["succeeded", "recovered"].includes(report.status)) process.exitCode = 1;
}
main().catch(() => {
  console.error(
    "Deployment failed. Inspect the sanitized release manifest and AWS resource status.",
  );
  process.exitCode = 1;
});
