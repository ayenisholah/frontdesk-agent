import { CfnParameter, CfnRule, Fn } from "aws-cdk-lib";
import type { RuntimeContext } from "./runtime-context";
export function createReleaseParameters({ stack, settings }: RuntimeContext) {
  const sha = (id: string) =>
    new CfnParameter(stack, id, {
      type: "String",
      default: settings.releaseSha,
      allowedPattern: "^[a-f0-9]{40}$",
    }).valueAsString;
  const desiredCount = new CfnParameter(stack, "ServiceDesiredCount", {
    type: "Number",
    default: settings.desiredCount,
    allowedValues: ["0", "1"],
  });
  const prepared = new CfnParameter(stack, "DatabasePrepared", {
    type: "String",
    default: String(settings.databasePrepared),
    allowedValues: ["true", "false"],
  });
  new CfnRule(stack, "PreparedDatabaseRequired", {
    assertions: [
      {
        assert: Fn.conditionOr(
          Fn.conditionEquals(desiredCount.valueAsString, "0"),
          Fn.conditionEquals(prepared.valueAsString, "true"),
        ),
        assertDescription: "Database preparation must succeed before services start",
      },
    ],
  });
  return {
    app: sha("AppReleaseSha"),
    migration: sha("MigrationReleaseSha"),
    desiredCount: desiredCount.valueAsNumber,
  };
}
