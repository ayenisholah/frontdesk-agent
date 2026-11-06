import { Template } from "aws-cdk-lib/assertions";
import { expect, it } from "vitest";
import { createFoundation } from "../src/app";
import { parseInfraConfig } from "../src/config";
import runtimeFixture from "../config/runtime.example.json";
it("limits OIDC to the immutable production subject and avoids secret or infrastructure administration", () => {
  const config = parseInfraConfig({ ...runtimeFixture, deployment: { enabled: true } });
  const { access } = createFoundation(config);
  const template = Template.fromStack(access!);
  const text = JSON.stringify(template.toJSON());
  expect(text).toContain(
    "repo:ayenisholah@49761315/frontdesk-agent@1441751147:environment:production",
  );
  expect(text).not.toContain("secretsmanager:GetSecretValue");
  expect(text).not.toContain("iam:CreateRole");
  expect(text).not.toContain("cloudformation:CreateStack");
  template.resourceCountIs("AWS::IAM::Role", 2);
  template.resourceCountIs("Custom::AWSCDKOpenIdConnectProvider", 0);
}, 30_000);
it("imports an existing provider and rejects deployment access without runtime or matching account", () => {
  const providerArn = "arn:aws:iam::111111111111:oidc-provider/token.actions.githubusercontent.com";
  const input = { ...runtimeFixture, deployment: { enabled: true, providerArn } };
  expect(() =>
    parseInfraConfig({
      ...input,
      deployment: {
        enabled: true,
        providerArn: providerArn.replace("token.actions", "tokenXactions"),
      },
    }),
  ).toThrow("Invalid infrastructure configuration");
  const { access } = createFoundation(parseInfraConfig(input));
  Template.fromStack(access!).resourceCountIs("AWS::IAM::OIDCProvider", 0);
  expect(() => parseInfraConfig({ ...input, runtime: undefined })).toThrow(
    "Invalid infrastructure configuration",
  );
  expect(() =>
    parseInfraConfig({
      ...input,
      deployment: {
        enabled: true,
        providerArn: providerArn.replace("111111111111", "222222222222"),
      },
    }),
  ).toThrow("Invalid infrastructure configuration");
}, 30_000);
