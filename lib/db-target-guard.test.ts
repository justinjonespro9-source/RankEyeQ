import { describe, expect, it } from "vitest";
import {
  ProductionDatabaseGuardError,
  assertNonProductionDatabase,
  databaseHostFromUrl,
} from "@/lib/db-target-guard";

const PROD = "postgresql://u:p@ep-curly-bonus-ax4xh6fm-pooler.c-4.us-east-2.aws.neon.tech/neondb";
const PREVIEW = "postgresql://u:p@ep-aged-sunset-axbayr5e-pooler.c-4.us-east-2.aws.neon.tech/neondb";
const LOCAL = "postgresql://u:p@localhost:5432/rankiq?schema=public";

describe("production database guard", () => {
  it("parses hosts without exposing credentials", () => {
    expect(databaseHostFromUrl(`"${LOCAL}"`)).toBe("localhost");
    expect(databaseHostFromUrl("not a url")).toBeNull();
  });

  it("allows local and Preview databases", () => {
    for (const url of [LOCAL, PREVIEW]) {
      expect(() =>
        assertNonProductionDatabase({
          context: "t",
          env: { DATABASE_URL: url },
          allowOverride: false,
        }),
      ).not.toThrow();
    }
  });

  it("blocks Production for tests even with the override set", () => {
    expect(() =>
      assertNonProductionDatabase({
        context: "vitest",
        env: { DATABASE_URL: PROD, RANKEYEQ_ALLOW_PRODUCTION_DB: "1" },
        allowOverride: false,
      }),
    ).toThrow(ProductionDatabaseGuardError);
  });

  it("blocks Production for Prisma CLI unless explicitly overridden", () => {
    expect(() =>
      assertNonProductionDatabase({
        context: "prisma",
        env: { DATABASE_URL: PROD },
        allowOverride: true,
      }),
    ).toThrow(ProductionDatabaseGuardError);
    expect(() =>
      assertNonProductionDatabase({
        context: "prisma",
        env: { DATABASE_URL: PROD, RANKEYEQ_ALLOW_PRODUCTION_DB: "1" },
        allowOverride: true,
      }),
    ).not.toThrow();
  });
});
