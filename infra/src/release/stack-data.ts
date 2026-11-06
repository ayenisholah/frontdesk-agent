import { z } from "zod";
const text = z.string().min(1);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const outputs = z.object({
  ApiRepositoryUri: text,
  WorkerRepositoryUri: text,
  MigrationRepositoryUri: text,
  ClusterArn: text,
  MigrationTaskDefinitionArn: text,
  ApiTaskDefinitionArn: text,
  WorkerTaskDefinitionArn: text,
  ApplicationSubnetIds: text,
  MigrationSecurityGroupId: text,
  ApiServiceName: text,
  WorkerServiceName: text,
  ApiEndpoint: z.url().startsWith("https://"),
  TargetGroupArn: text,
});
const parameters = z.object({
  AppReleaseSha: sha,
  MigrationReleaseSha: sha,
  ServiceDesiredCount: z.enum(["0", "1"]),
  DatabasePrepared: z.enum(["true", "false"]),
});
const response = z.object({
  Stacks: z
    .array(
      z.object({
        StackStatus: text,
        Parameters: z.array(z.object({ ParameterKey: text, ParameterValue: text })),
        Outputs: z.array(z.object({ OutputKey: text, OutputValue: text })),
      }),
    )
    .length(1),
});
export function parseStack(input: unknown) {
  const s = response.parse(input).Stacks[0]!;
  const p = parameters.parse(
    Object.fromEntries(s.Parameters.map((p) => [p.ParameterKey, p.ParameterValue])),
  );
  return {
    status: s.StackStatus,
    parameters: s.Parameters,
    snapshot: {
      app: p.AppReleaseSha,
      migration: p.MigrationReleaseSha,
      count: Number(p.ServiceDesiredCount) as 0 | 1,
      prepared: p.DatabasePrepared,
    },
    outputs: outputs.parse(Object.fromEntries(s.Outputs.map((o) => [o.OutputKey, o.OutputValue]))),
  };
}
export type StackData = ReturnType<typeof parseStack>;
