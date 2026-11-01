// Fails when a semantic text/background pair drops below its WCAG AA minimum in either theme.
import { contrastPairs, semantic } from "../design/tokens";
import { contrast } from "../design/fluid";

let failed = 0;
for (const theme of ["light", "dark"] as const) {
  for (const [fg, bg, min] of contrastPairs) {
    const ratio = contrast(semantic[theme][fg] ?? "", semantic[theme][bg] ?? "");
    const ok = ratio >= min;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${theme.padEnd(5)} ${fg} on ${bg}: ${ratio.toFixed(2)} (min ${min})`);
  }
}
if (failed) {
  console.error(`${failed} contrast pair(s) below AA.`);
  process.exit(1);
}
