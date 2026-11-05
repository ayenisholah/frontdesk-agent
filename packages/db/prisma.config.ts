// Prisma 7 reads the connection string here rather than from schema.prisma.
// `prisma generate` needs no database, so a missing DATABASE_URL is only an error for
// commands that connect (migrate, db seed).
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx scripts/seed.ts",
  },
  ...(process.env.DATABASE_URL ? { datasource: { url: process.env.DATABASE_URL } } : {}),
});
