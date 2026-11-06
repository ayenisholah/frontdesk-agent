import { RemovalPolicy, Validations, aws_secretsmanager as secrets } from "aws-cdk-lib";
import type { RuntimeContext } from "./runtime-context";
export function createRuntimeCredential({ dataStack, data }: RuntimeContext) {
  const credential = new secrets.Secret(dataStack, "RuntimeCredential", {
    encryptionKey: data.key,
    removalPolicy: RemovalPolicy.RETAIN,
    generateSecretString: {
      secretStringTemplate: JSON.stringify({ username: "frontdesk_runtime" }),
      generateStringKey: "password",
      passwordLength: 32,
      excludePunctuation: true,
    },
  });
  Validations.of(credential).acknowledge({
    id: "AwsSolutions-SMG4",
    reason:
      "Runtime role rotation requires database password update and task replacement; preparation has zero tasks and live activation requires the documented coordinated procedure.",
  });
  return credential;
}
