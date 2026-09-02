import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pgPool: Pool | undefined;
};

function createPgPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  return new Pool({ connectionString });
}

function createPrismaClient(pool: Pool) {
  // Pass an explicit Pool so concurrent Prisma queries never share one Client.
  // Write+include still uses an implicit transaction (PoolClient); those call
  // sites must load relations with a separate find after the write.
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

const pool = globalForPrisma.pgPool ?? createPgPool();
export const prisma = globalForPrisma.prisma ?? createPrismaClient(pool);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.pgPool = pool;
  globalForPrisma.prisma = prisma;
}
