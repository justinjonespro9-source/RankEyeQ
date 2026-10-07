import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.join(process.cwd(), "prisma/migrations");
const read = (name: string) => readFileSync(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
const SQL = read("20261007000000_waivers_snapshot_frozen_identity");
const PHASE3_SQL = read("20261002000000_waivers_snapshot_integrity");

function statements(sql: string): string[] {
  return sql
    .replace(/\$\$[\s\S]*?\$\$/g, () => "$$BODY$$")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const body = (sql: string, name: string) => sql.match(new RegExp(`FUNCTION "${name}"\\(\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`))![1];

describe("Stage 4B.1 frozen identity migration (static)", () => {
  it("is additive: two nullable columns, one CHECK and the replaced entry guard", () => {
    expect(statements(SQL)).toEqual([
      'ALTER TABLE "WaiverSnapshotEntry" ADD COLUMN "identityProviderAtFreeze" TEXT',
      'ALTER TABLE "WaiverSnapshotEntry" ADD COLUMN "identityExternalIdAtFreeze" TEXT',
      'ALTER TABLE "WaiverSnapshotEntry" ADD CONSTRAINT "WaiverSnapshotEntry_frozen_identity_check" CHECK ( ("identityProviderAtFreeze" IS NULL) = ("identityExternalIdAtFreeze" IS NULL) )',
      'CREATE OR REPLACE FUNCTION "waiver_snapshot_entry_guard"() RETURNS trigger LANGUAGE plpgsql AS $$BODY$$',
    ]);
  });

  it("writes no rows (no backfill) and drops or rewrites nothing", () => {
    expect(SQL).not.toMatch(/\b(DROP|TRUNCATE|INSERT INTO|DELETE FROM|UPDATE "|ALTER COLUMN|CREATE TABLE|CREATE TYPE|NOT NULL|DEFAULT)\b/i);
    expect(SQL).not.toMatch(/set_config|SET LOCAL|SET rankeyeq/i);
  });

  it("keeps every Phase 3 entry-guard rule verbatim and only adds INSERT identity checks", () => {
    const previous = body(PHASE3_SQL, "waiver_snapshot_entry_guard");
    const next = body(SQL, "waiver_snapshot_entry_guard");
    const previousRules = previous.slice(0, previous.indexOf("  RETURN NEW;"));
    expect(next.startsWith(previousRules)).toBe(true);
    const added = next.slice(previousRules.length);
    expect(added).not.toMatch(/waiver_fixture_maintenance|TG_OP/);
    expect(added).toMatch(/"identityProviderAtFreeze" IS NULL OR NEW\."identityExternalIdAtFreeze" IS NULL/);
    expect(added).toMatch(/r\."provider" = NEW\."identityProviderAtFreeze"/);
    expect(added).toMatch(/r\."externalId" = NEW\."identityExternalIdAtFreeze"/);
    expect(added).toMatch(/FOR KEY SHARE/);
  });
});
