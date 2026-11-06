import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { resolveRuntimeEnvironment } from "@frontdesk/runtime";
import { provisionRuntimeAccess } from "../src/runtime-access";

async function main() {
  const env = resolveRuntimeEnvironment(process.env);
  const password = env.RUNTIME_DATABASE_PASSWORD;
  if (!env.DATABASE_URL || !password || password.length < 16)
    throw new Error("Invalid configuration");
  execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL("../../../node_modules/prisma/build/index.js", import.meta.url)),
      "migrate",
      "deploy",
    ],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), env, stdio: "pipe" },
  );
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  try {
    await client.connect();
    await provisionRuntimeAccess(client, { role: "frontdesk_runtime", password });
    console.log("Database preparation completed.");
  } finally {
    await client.end();
  }
}
main().catch(() => {
  console.error("Database preparation failed. Check task configuration and database connectivity.");
  process.exitCode = 1;
});
