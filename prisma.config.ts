import "dotenv/config";
import { defineConfig } from "prisma/config";
import { assertNonProductionDatabase } from "./lib/db-target-guard";

// Vercel builds legitimately use the Production DATABASE_URL for `prisma generate`.
if (process.env.VERCEL !== "1") {
  assertNonProductionDatabase({ context: "prisma", allowOverride: true });
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
