import {
  DescribeRepositoriesCommand,
  DescribeImagesCommand,
  GetAuthorizationTokenCommand,
} from "@aws-sdk/client-ecr";
import { z } from "zod";
import type { DeploymentConfig } from "./config";
import type { StackData } from "./stack-data";
import type { Images } from "./types";
type Command = DescribeRepositoriesCommand | DescribeImagesCommand | GetAuthorizationTokenCommand;
type Ports = {
  config: DeploymentConfig;
  read(): Promise<StackData>;
  send(c: Command): Promise<unknown>;
  docker(args: string[], stdin?: string): Promise<string>;
};
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export function createPublisher(ports: Ports) {
  return async (sha: string): Promise<Images> => {
    const { outputs } = await ports.read();
    const registry = `${ports.config.account}.dkr.ecr.${ports.config.region}.amazonaws.com`;
    await login(ports, registry);
    const result = {} as Images;
    for (const [name, uri] of Object.entries({
      api: outputs.ApiRepositoryUri,
      worker: outputs.WorkerRepositoryUri,
      migrate: outputs.MigrationRepositoryUri,
    })) {
      if (
        !uri.startsWith(registry + "/") ||
        !/^[a-z0-9/_.-]+$/.test(uri.slice(registry.length + 1))
      )
        throw new Error("Unexpected image repository");
      const repositoryName = uri.slice(registry.length + 1);
      const repo = z
        .object({
          repositories: z.array(z.object({ imageTagMutability: z.literal("IMMUTABLE") })).length(1),
        })
        .safeParse(
          await ports.send(new DescribeRepositoriesCommand({ repositoryNames: [repositoryName] })),
        );
      if (!repo.success) throw new Error("Image repository must be immutable");
      const existing = await imageDigest(ports, repositoryName, sha);
      const image = `${uri}:${sha}`;
      if (existing) await ports.docker(["pull", `${uri}@${existing}`]);
      const source = existing ? `${uri}@${existing}` : `frontdesk-${name}:${sha}`;
      const revision = await ports.docker([
        "image",
        "inspect",
        source,
        "--format",
        '{{index .Config.Labels "org.opencontainers.image.revision"}}',
      ]);
      if (revision.trim() !== sha) throw new Error("Image revision mismatch");
      if (!existing) {
        await ports.docker(["tag", source, image]);
        await ports.docker(["push", image]);
      }
      result[name as keyof Images] = digest.parse(await imageDigest(ports, repositoryName, sha));
    }
    return result;
  };
}
async function imageDigest(ports: Ports, repositoryName: string, sha: string) {
  try {
    const result = z
      .object({ imageDetails: z.array(z.object({ imageDigest: digest })).length(1) })
      .parse(
        await ports.send(
          new DescribeImagesCommand({ repositoryName, imageIds: [{ imageTag: sha }] }),
        ),
      );
    return result.imageDetails[0]!.imageDigest;
  } catch (error) {
    if (z.object({ name: z.literal("ImageNotFoundException") }).safeParse(error).success)
      return undefined;
    throw new Error("Image lookup failed", { cause: error });
  }
}
async function login(ports: Ports, registry: string) {
  const response = z
    .object({
      authorizationData: z
        .array(
          z.object({
            authorizationToken: z.string(),
            proxyEndpoint: z.literal(`https://${registry}`),
          }),
        )
        .length(1),
    })
    .parse(
      await ports.send(new GetAuthorizationTokenCommand({ registryIds: [ports.config.account] })),
    );
  const token = Buffer.from(response.authorizationData[0]!.authorizationToken, "base64").toString(
    "utf8",
  );
  if (!token.startsWith("AWS:") || token.length <= 4)
    throw new Error("Invalid registry authorization");
  await ports.docker(["login", "--username", "AWS", "--password-stdin", registry], token.slice(4));
}
