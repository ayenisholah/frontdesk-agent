import { expect, it } from "vitest";
import { DescribeRepositoriesCommand, DescribeImagesCommand } from "@aws-sdk/client-ecr";
import { createPublisher } from "../src/release/images";
import { config, stackResponse } from "./release-fixture";
import { parseStack } from "../src/release/stack-data";
it("reuses immutable images only after checking the revision label", async () => {
  const docker: string[][] = [];
  const publish = createPublisher({
    config,
    read: async () => parseStack(stackResponse()),
    docker: async (args) => {
      docker.push(args);
      return "a".repeat(40);
    },
    send: async (c) => {
      if (c instanceof DescribeRepositoriesCommand)
        return { repositories: [{ imageTagMutability: "IMMUTABLE" }] };
      if (c instanceof DescribeImagesCommand)
        return { imageDetails: [{ imageDigest: "sha256:" + "a".repeat(64) }] };
      return {
        authorizationData: [
          {
            authorizationToken: Buffer.from("AWS:private").toString("base64"),
            proxyEndpoint: "https://111111111111.dkr.ecr.eu-west-1.amazonaws.com",
          },
        ],
      };
    },
  });
  expect((await publish("a".repeat(40))).api).toBe("sha256:" + "a".repeat(64));
  expect(docker.filter((args) => args[0] === "pull")).toHaveLength(3);
  expect(docker.some((args) => args.includes("private"))).toBe(false);
});
it("publishes missing images without exposing the registry password in arguments", async () => {
  const images = new Set<string>();
  const calls: string[][] = [];
  let current = "";
  const publish = createPublisher({
    config,
    read: async () => parseStack(stackResponse()),
    docker: async (args, input) => {
      calls.push(args);
      if (args[0] === "login") expect(input).toBe("private");
      if (args[0] === "push") images.add(current);
      return "a".repeat(40);
    },
    send: async (c) => {
      if (c instanceof DescribeRepositoriesCommand)
        return { repositories: [{ imageTagMutability: "IMMUTABLE" }] };
      if (c instanceof DescribeImagesCommand) {
        current = c.input.repositoryName!;
        if (!images.has(current))
          throw Object.assign(new Error("absent"), { name: "ImageNotFoundException" });
        return { imageDetails: [{ imageDigest: "sha256:" + "a".repeat(64) }] };
      }
      return {
        authorizationData: [
          {
            authorizationToken: Buffer.from("AWS:private").toString("base64"),
            proxyEndpoint: "https://111111111111.dkr.ecr.eu-west-1.amazonaws.com",
          },
        ],
      };
    },
  });
  await publish("a".repeat(40));
  expect(calls.filter((c) => c[0] === "push")).toHaveLength(3);
});
it("rejects wrong registries, mutable tags, bad revisions and invalid authorization", async () => {
  for (const mode of [
    "registry",
    "repository",
    "mutable",
    "revision",
    "lookup",
    "token",
    "empty-token",
  ]) {
    const stack = parseStack(stackResponse());
    if (mode === "registry") stack.outputs.ApiRepositoryUri = "other.example/api";
    if (mode === "repository") stack.outputs.ApiRepositoryUri += "?secret";
    const publish = createPublisher({
      config,
      read: async () => stack,
      docker: async () => (mode === "revision" ? "other" : "a".repeat(40)),
      send: async (c) => {
        if (c instanceof DescribeRepositoriesCommand)
          return {
            repositories: [{ imageTagMutability: mode === "mutable" ? "MUTABLE" : "IMMUTABLE" }],
          };
        if (c instanceof DescribeImagesCommand) {
          if (mode === "lookup") throw new Error("private details");
          return { imageDetails: [{ imageDigest: "sha256:" + "a".repeat(64) }] };
        }
        return {
          authorizationData: [
            {
              authorizationToken: Buffer.from(
                mode === "token" ? "BAD:private" : mode === "empty-token" ? "AWS:" : "AWS:private",
              ).toString("base64"),
              proxyEndpoint: "https://111111111111.dkr.ecr.eu-west-1.amazonaws.com",
            },
          ],
        };
      },
    });
    await expect(publish("a".repeat(40))).rejects.toThrow();
  }
});
