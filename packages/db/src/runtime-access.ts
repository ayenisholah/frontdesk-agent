import type pg from "pg";
import { z } from "zod";
const credentials = z.object({
  role: z.string().regex(/^frontdesk_runtime(?:_[a-f0-9]{8})?$/),
  password: z.string().min(16),
});
/** Run after migrations using the schema owner. Runtime receives DML, never DDL. */
export async function provisionRuntimeAccess(client: Pick<pg.Client, "query">, input: unknown) {
  const parsed = credentials.safeParse(input);
  if (!parsed.success) throw new Error("Invalid runtime database credentials");
  const { role, password } = parsed.data;
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('frontdesk-runtime-provision'))");
    const existing = await client.query<{ unsafe: boolean }>(
      "SELECT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid)) AS unsafe FROM pg_roles WHERE rolname=$1",
      [role],
    );
    if (existing.rows[0]?.unsafe) throw new Error("Unsafe existing runtime database role");
    if (!existing.rows.length) await formatted(client, "CREATE ROLE %I NOLOGIN", [role]);
    await formatted(client, "ALTER ROLE %I LOGIN NOINHERIT PASSWORD %L", [role, password]);
    await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    await formatted(client, "REVOKE ALL ON SCHEMA public FROM %I", [role]);
    await formatted(client, "GRANT USAGE ON SCHEMA public TO %I", [role]);
    await formatted(client, "REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I", [role]);
    const tables = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'",
    );
    for (const table of tables.rows)
      await formatted(client, "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO %I", [
        table.tablename,
        role,
      ]);
    await formatted(client, "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I", [role]);
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
    throw new Error("Runtime database provisioning failed");
  }
}
async function formatted(client: Pick<pg.Client, "query">, format: string, values: string[]) {
  const placeholders = values.map((_, index) => `$${index + 2}::text`).join(",");
  const result = await client.query<{ sql: string }>(
    `SELECT format($1::text,${placeholders}) AS sql`,
    [format, ...values],
  );
  await client.query(result.rows[0]!.sql);
}
