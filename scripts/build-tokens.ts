// Writes apps/dashboard/styles/tokens.css from design/tokens.ts. `--check` fails if the file is stale.
import { readFileSync, writeFileSync } from "node:fs";
import { tokensCss } from "../design/fluid";

const target = new URL("../apps/dashboard/styles/tokens.css", import.meta.url);
const css = tokensCss();
if (process.argv.includes("--check")) {
  const current = readFileSync(target, "utf8");
  if (current !== css) {
    console.error("apps/dashboard/styles/tokens.css is out of date. Run `npm run tokens`.");
    process.exit(1);
  }
  console.log("tokens.css is up to date.");
} else {
  writeFileSync(target, css);
  console.log("Wrote apps/dashboard/styles/tokens.css");
}
