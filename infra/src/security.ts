import { App, Validations } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
export function applySecurityChecks(app: App) {
  const checks = new AwsSolutionsChecks(app, {
    verbose: true,
    writeSuppressionsToCloudFormation: true,
  });
  Validations.of(app).addPlugins(checks);
  return checks;
}
