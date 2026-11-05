import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "./generated/client";

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;

/** A Prisma client over node-postgres. Call `$disconnect()` on shutdown. */
export function createDb(databaseUrl: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
