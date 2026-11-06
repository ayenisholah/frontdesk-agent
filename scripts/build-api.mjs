import { build } from "esbuild";
import { readFile } from "node:fs/promises";

// Bundle workspace source; npm installs third-party runtime packages in the image.
const paths = ["apps/api", "packages/channels", "packages/core", "packages/db", "packages/agent"];
const manifests = await Promise.all(
  paths.map(async (path) => JSON.parse(await readFile(`${path}/package.json`, "utf8"))),
);
const external = [
  ...new Set(
    manifests
      .flatMap((manifest) => Object.keys(manifest.dependencies))
      .filter((name) => !name.startsWith("@frontdesk/")),
  ),
];
await build({
  entryPoints: ["apps/api/src/server.ts"],
  outfile: "apps/api/dist/server.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  external,
});
