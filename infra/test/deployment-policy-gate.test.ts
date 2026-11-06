import { Template } from "aws-cdk-lib/assertions";
import { z } from "zod";
import { expect, it } from "vitest";
import { createFoundation } from "../src/app";
import { parseInfraConfig } from "../src/config";
import fixture from "../config/deployment.example.json";
const action = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (typeof v === "string" ? [v] : v));
const statement = z.object({
  Action: action,
  Resource: z.unknown(),
  Condition: z.unknown().optional(),
});
function check(input: unknown) {
  const policy = z.object({ Statement: z.array(statement) }).parse(input);
  for (const s of policy.Statement) {
    expect(s.Action.some((a) => a.includes("*"))).toBe(false);
    if (s.Resource === "*") {
      for (const a of s.Action)
        expect([
          "ecr:GetAuthorizationToken",
          "elasticloadbalancing:DescribeTargetHealth",
          "ecs:ListTasks",
        ]).toContain(a);
      if (s.Action.includes("ecs:ListTasks"))
        expect(s.Condition).toEqual(
          expect.objectContaining({ ArnEquals: expect.any(Object) as unknown }),
        );
    }
    if (s.Action.includes("iam:PassRole")) {
      expect(s.Resource).not.toBe("*");
      expect(s.Condition).toEqual(
        expect.objectContaining({
          StringEquals: expect.objectContaining({
            "iam:PassedToService": expect.stringMatching(
              /^(cloudformation|ecs-tasks)\.amazonaws\.com$/,
            ) as unknown,
          }) as unknown,
        }),
      );
    }
  }
}
it("rejects planted broad role passing even when a required global permission is acknowledged", () => {
  const { access } = createFoundation(parseInfraConfig(fixture));
  const template = Template.fromStack(access!);
  for (const resource of Object.values(template.findResources("AWS::IAM::Policy")))
    check(resource.Properties.PolicyDocument);
  expect(() => check({ Statement: [{ Action: "iam:PassRole", Resource: "*" }] })).toThrow();
  expect(() => check({ Statement: [{ Action: "ecs:*", Resource: "*" }] })).toThrow();
}, 30_000);
