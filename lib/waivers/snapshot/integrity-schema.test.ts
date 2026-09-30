import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.join(process.cwd(), "prisma/migrations");
const PHASE3_MIGRATION = "20261002000000_waivers_snapshot_integrity";
const SQL = readFileSync(path.join(MIGRATIONS_DIR, PHASE3_MIGRATION, "migration.sql"), "utf8");

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

describe("Phase 3 snapshot integrity migration (static)", () => {
  it("changes no tables, columns or enums", () => {
    const allowed = [
      /^ALTER TABLE "WaiverSnapshot(Entry|Correction)?" ADD CONSTRAINT "WaiverSnapshot(Entry|Correction)?_\w+_check" CHECK \(/,
      /^CREATE FUNCTION "waiver_snapshot_\w+"\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$BODY\$\$$/,
      /^CREATE TRIGGER "WaiverSnapshot(Entry|Correction)?_guard" BEFORE INSERT OR UPDATE OR DELETE ON "WaiverSnapshot(Entry|Correction)?" FOR EACH ROW EXECUTE FUNCTION "waiver_snapshot_\w+"\(\)$/,
      /^CREATE CONSTRAINT TRIGGER "WaiverSnapshot(Entry)?_\w+" AFTER (INSERT|UPDATE) ON "WaiverSnapshot(Entry)?" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "waiver_snapshot_\w+"\(\)$/,
    ];
    expect(statements(SQL).filter((s) => !allowed.some((re) => re.test(s)))).toEqual([]);
    expect(SQL).not.toMatch(/\b(DROP|TRUNCATE|INSERT INTO|DELETE FROM|UPDATE "|ALTER COLUMN|CREATE TABLE|CREATE TYPE)\b/i);
  });

  it("only reads the fixture-maintenance switch (never sets it) and allows no maintenance UPDATE", () => {
    expect(SQL).not.toMatch(/set_config|SET LOCAL|SET rankeyeq/i);
    const snapshotGuard = SQL.match(/CREATE FUNCTION "waiver_snapshot_guard"[\s\S]*?\$\$;/)![0];
    const maintenanceBranches = snapshotGuard.match(/waiver_fixture_maintenance/g) ?? [];
    expect(maintenanceBranches).toHaveLength(1);
    expect(snapshotGuard.indexOf("waiver_fixture_maintenance")).toBeLessThan(snapshotGuard.indexOf("TG_OP = 'UPDATE'"));
  });

  it("declares the approved CHECK constraints", () => {
    for (const name of [
      "WaiverSnapshot_thresholdBps_check",
      "WaiverSnapshot_version_check",
      "WaiverSnapshot_counts_check",
      "WaiverSnapshotEntry_rosteredBps_check",
      "WaiverSnapshotEntry_inputLineNumber_check",
      "WaiverSnapshotEntry_role_check",
      "WaiverSnapshotEntry_exclusion_check",
      "WaiverSnapshotCorrection_affected_check",
    ]) {
      expect(SQL).toContain(`"${name}"`);
    }
  });
});
