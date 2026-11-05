// Gives a test file its own migrated database, dropped afterwards, so tests never touch dev data.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll } from "vitest";
import { createDb, type Db } from "../src/index";

export const baseUrl = process.env.DATABASE_URL;
const pkgDir = fileURLToPath(new URL("..", import.meta.url));

/** Call inside a describe block. Returns accessors, valid once the tests start. */
export function useTestDatabase() {
  const name = `frontdesk_test_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let db: Db;
  let url: string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: baseUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    const parsed = new URL(baseUrl!);
    parsed.pathname = `/${name}`;
    url = parsed.toString();
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: pkgDir,
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
    });
    db = createDb(url);
  }, 60_000);

  afterAll(async () => {
    await db?.$disconnect();
    await admin?.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin?.end();
  });

  return { db: () => db };
}
