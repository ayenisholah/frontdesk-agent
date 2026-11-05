// Fails when a stylesheet or component uses px. The design system sizes everything in
// rem (type, space, radii, borders), em (relative to own text) or % / fr (layout).
// Exception: image `sizes` hints, which browsers require in CSS lengths of the viewport.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["apps/dashboard", "design"];
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(css|tsx|ts|html)$/.test(name)) files.push(p);
  }
};
for (const r of roots) {
  try {
    walk(r);
  } catch {
    // A root that doesn't exist yet has nothing to audit.
  }
}
const problems = [];
for (const file of files) {
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (/sizes=/.test(line)) return;
      const hit = line.match(/(?<![\w-])\d*\.?\d+px\b/) || line.match(/["'`]px["'`]/);
      if (hit) problems.push(`${file}:${i + 1}: ${hit[0]}  ${line.trim().slice(0, 100)}`);
    });
}
if (problems.length) {
  console.error(`px found (${problems.length}). Use rem, em or %:\n` + problems.join("\n"));
  process.exit(1);
}
console.log(`No px in ${files.length} files.`);
