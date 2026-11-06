/** Module boundaries from docs/ENGINEERING_STANDARDS.md, enforced in CI. */
module.exports = {
  forbidden: [
    {
      name: "runtime-does-not-import-infra",
      severity: "error",
      from: { path: "^(apps|packages)/" },
      to: { path: "^infra/" },
    },
    {
      name: "infra-does-not-import-runtime",
      severity: "error",
      from: { path: "^infra/" },
      to: { path: "^(apps|packages)/" },
    },
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
    {
      name: "core-has-no-io",
      comment:
        "packages/core is pure domain logic: no Node built-ins, no I/O packages, no other workspaces.",
      severity: "error",
      from: { path: "^packages/core/src" },
      to: { dependencyTypes: ["core", "npm"], pathNot: "node_modules/zod" },
    },
    {
      name: "core-depends-on-nothing-internal",
      severity: "error",
      from: { path: "^packages/core/src" },
      to: { path: "^(apps|packages/(agent|channels|db))/" },
    },
    {
      name: "packages-do-not-import-apps",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "apps-do-not-import-apps",
      severity: "error",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/", pathNot: "^apps/$1/" },
    },
    {
      name: "no-deep-package-imports",
      comment: "Import a workspace package through its entry point, not its internals.",
      severity: "error",
      from: { path: "^(apps|packages)/([^/]+)/", pathNot: "/test/" },
      to: { path: "^packages/([^/]+)/src/(?!index\\.ts$)", pathNot: "^packages/$2/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(dist|generated)/" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "default"] },
  },
};
