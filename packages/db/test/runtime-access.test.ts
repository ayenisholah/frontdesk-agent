import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { baseUrl, useTestDatabase } from "./test-db";
import { provisionRuntimeAccess } from "../src/runtime-access";
describe.skipIf(!baseUrl)("runtime database permissions", () => {
  const database = useTestDatabase();
  it("is repeatable, allows business DML, and denies schema and migration-ledger changes", async () => {
    const admin = new pg.Client({ connectionString: database.url() });
    const role = `frontdesk_runtime_${randomBytes(4).toString("hex")}`;
    await admin.connect();
    try {
      await provisionRuntimeAccess(admin, { role, password: "fictional-'quoted-password" });
      await provisionRuntimeAccess(admin, { role, password: "fictional-'quoted-password" });
      await admin.query(`SET ROLE "${role}"`);
      await expect(admin.query('SELECT count(*) FROM "Business"')).resolves.toBeDefined();
      await expect(
        admin.query('UPDATE "Business" SET name=name WHERE false'),
      ).resolves.toBeDefined();
      await expect(admin.query("CREATE TABLE forbidden (id int)")).rejects.toThrow(
        /permission denied/,
      );
      await expect(admin.query('DELETE FROM "_prisma_migrations"')).rejects.toThrow(
        /permission denied/,
      );
      await admin.query("RESET ROLE");
      await admin.query(`ALTER ROLE "${role}" CREATEDB`);
      await expect(
        provisionRuntimeAccess(admin, { role, password: "fictional-password" }),
      ).rejects.toThrow("Runtime database provisioning failed");
      await expect(
        provisionRuntimeAccess(admin, { role: "unsafe;sql", password: "private" }),
      ).rejects.toThrow("Invalid runtime database credentials");
    } finally {
      await admin.query("RESET ROLE");
      await admin.query(`DROP OWNED BY "${role}"`);
      await admin.query(`DROP ROLE "${role}"`);
      await admin.end();
    }
  });
});
