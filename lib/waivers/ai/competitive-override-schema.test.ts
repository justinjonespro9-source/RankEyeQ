import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const MIGRATIONS = path.join(ROOT, "prisma/migrations");
const read = (name: string) => readFileSync(path.join(MIGRATIONS, name, "migration.sql"), "utf8");
const STAGE4B3B = "20261010000000_waivers_ai_late_entry";
const STAGE4B3C = "20261011000000_waivers_ai_competitive_override";
const uncommented = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
const LATE = uncommented(read(STAGE4B3B));
const CODE = uncommented(read(STAGE4B3C));
const LOCK_GUARDS = ["waiver_submission_guard", "waiver_revision_guard", "waiver_call_guard", "waiver_ai_response_guard", "waiver_ai_response_prompt_guard"];
const HELPER = "waiver_ai_late_entry_in_transaction";

function functionBody(sql: string, name: string): string {
  const start = sql.search(new RegExp(`^CREATE (OR REPLACE )?FUNCTION "${name}"\\(`, "m"));
  expect(start, name).toBeGreaterThan(-1);
  const open = sql.indexOf("$$", start) + 2;
  return sql
    .slice(open, sql.indexOf("$$;", open))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

describe("Stage 4B.3C admin competitive override migration (static)", () => {
  it("adds one table and never changes privileges, lock times, trigger enablement or existing data", () => {
    expect(CODE).not.toMatch(/\bGRANT\b|\bREVOKE\b|DISABLE TRIGGER|DROP TRIGGER|DROP FUNCTION|\bDROP\b|ALTER TYPE|ALTER COLUMN|SECURITY DEFINER|CREATE TYPE/i);
    expect(CODE).not.toMatch(/^\s*(INSERT INTO|UPDATE "|DELETE FROM)/im);
    expect(CODE).not.toMatch(/"locksAt"\s*:?=/);
    expect(CODE).not.toMatch(/ON DELETE (CASCADE|SET NULL|SET DEFAULT|NO ACTION)/i);
    expect([...CODE.matchAll(/CREATE TABLE "(\w+)"/g)].map((match) => match[1])).toEqual(["WaiverAiCompetitiveOverride"]);
    expect(new Set([...CODE.matchAll(/ALTER TABLE "(\w+)"/g)].map((match) => match[1]))).toEqual(new Set(["WaiverAiCompetitiveOverride"]));
    expect([...CODE.matchAll(/CREATE (?:CONSTRAINT )?TRIGGER "(\w+)"[\s\S]*?ON "(\w+)"/g)].map((match) => match[2])).toEqual([
      "WaiverAiCompetitiveOverride",
      "WaiverAiCompetitiveOverride",
      "WaiverAiCompetitiveOverride",
    ]);
  });

  it("has no session flag or setting that could switch off a lock, and leaves every lock guard unchanged", () => {
    expect(CODE).not.toMatch(/current_setting|set_config|SET LOCAL|SET SESSION|session_replication_role/i);
    expect([...CODE.matchAll(/CREATE OR REPLACE FUNCTION "(\w+)"/g)].map((match) => match[1])).toEqual([HELPER]);
    const later = readdirSync(MIGRATIONS).filter((name) => name > STAGE4B3B && !name.endsWith(".toml"));
    expect(later).toContain(STAGE4B3C);
    for (const migration of later) {
      const sql = uncommented(read(migration));
      for (const name of LOCK_GUARDS) expect(sql, `${migration}: ${name}`).not.toMatch(new RegExp(`FUNCTION "${name}"`));
    }
  });

  it("extends the in-transaction authorization helper only with same-transaction overrides naming the board", () => {
    const before = functionBody(LATE, HELPER).split("\n");
    const after = functionBody(CODE, HELPER).split("\n");
    expect(after.slice(0, before.length)).toEqual(before);
    const added = after.slice(before.length).join("\n");
    expect(added).toMatch(/^UNION ALL\n/);
    expect(added).toMatch(/FROM "WaiverAiCompetitiveOverride" o\nWHERE o\."submissionId" = p_submission AND "waiver_xmin_is_current_transaction"\(o\.xmin::text::bigint\)$/);
    // The projection matches the approval row shape column for column.
    const table = LATE.slice(LATE.indexOf('CREATE TABLE "WaiverAiLateEntryApproval"'), LATE.indexOf(");", LATE.indexOf('CREATE TABLE "WaiverAiLateEntryApproval"')));
    const columns = [...table.matchAll(/^\s+"(\w+)" /gm)].map((match) => match[1]);
    const projection = added
      .slice(added.indexOf("SELECT") + 6, added.indexOf("FROM"))
      .split(",")
      .map((item) => item.trim());
    expect(projection).toHaveLength(columns.length);
    const mapped: Record<string, string> = { approvedByUserId: 'o."authorizedByUserId"', approvedAt: 'o."authorizedAt"' };
    columns.forEach((column, index) => {
      const expected = ["verificationId", "evidenceId", "note"].includes(column) ? "NULL::text" : (mapped[column] ?? `o."${column}"`);
      expect(projection[index], column).toBe(expected);
    });
  });

  it("makes the override admin-only, post-lock, pre-grading, AI-only, single-use and immutable", () => {
    const guard = functionBody(CODE, "waiver_ai_competitive_override_guard");
    expect(guard).toMatch(/'WAIVER_IMMUTABLE: AI competitive overrides are immutable'/);
    expect(guard).toMatch(/IF "waiver_fixture_maintenance"\(\) THEN\nRETURN OLD;/);
    expect(guard).toMatch(/NEW\."authorizedAt" := "waiver_utc_now"\(\);/);
    expect(guard).toMatch(/"waiver_require_admin"\(NEW\."authorizedByUserId"/);
    expect(guard).toMatch(/PERFORM "waiver_grade_week_lock"\(v_week\);\nIF "waiver_utc_now"\(\) < v_locks THEN/);
    expect(guard).toMatch(/IF NEW\."snapshotId" <> v_pinned OR NEW\."position" <> v_position THEN/);
    expect(guard).toMatch(/p\."profileType" = 'AI' AND p\."status" = 'ACTIVE' AND p\."competitorActive"/);
    expect(guard).toMatch(/FROM "WaiverSubmission" s WHERE s\."contestId" = NEW\."contestId" AND s\."universalProfileId" = NEW\."universalProfileId"/);
    expect(guard).toMatch(/FROM "WaiverAiLateEntryApproval" a WHERE a\."contestId" = NEW\."contestId"/);
    expect(guard).toMatch(/FROM "WaiverGradeRun" g WHERE g\."weekId" = v_week/);
    expect(guard).toMatch(/v_evidence\."responseSha256" <> NEW\."responseSha256"/);
    expect(guard).toMatch(/"waiver_ai_evidence_latest_review"\(NEW\."evidenceId"\) IS NOT DISTINCT FROM 'REJECTED'/);
    expect(CODE).toMatch(/CREATE TRIGGER "WaiverAiCompetitiveOverride_guard"\n {2}BEFORE INSERT OR UPDATE OR DELETE ON "WaiverAiCompetitiveOverride"/);
    expect(CODE).toMatch(/CREATE TRIGGER "WaiverAiCompetitiveOverride_no_truncate" BEFORE TRUNCATE ON "WaiverAiCompetitiveOverride"/);
    expect(CODE).toMatch(/"confirmation" = left\("responseSha256", 12\)/);
    expect(CODE).toMatch(/length\(btrim\("reason"\)\) BETWEEN 1 AND 2000/);
    expect(CODE).toMatch(/CREATE UNIQUE INDEX "WaiverAiCompetitiveOverride_contestId_universalProfileId_key"/);
    expect(CODE).toMatch(/CREATE UNIQUE INDEX "WaiverAiCompetitiveOverride_submissionId_key"/);
    expect(CODE).toMatch(/CREATE UNIQUE INDEX "WaiverAiCompetitiveOverride_revisionId_key"/);
  });

  it("checks at COMMIT that the override created exactly its locked board with the verbatim response and no prompt claim", () => {
    expect(CODE).toMatch(/CREATE CONSTRAINT TRIGGER "WaiverAiCompetitiveOverride_board"\n {2}AFTER INSERT ON "WaiverAiCompetitiveOverride"\n {2}DEFERRABLE INITIALLY DEFERRED/);
    expect(CODE).toMatch(/"WaiverAiCompetitiveOverride_submissionId_fkey" .* DEFERRABLE INITIALLY DEFERRED;/);
    expect(CODE).toMatch(/"WaiverAiCompetitiveOverride_revisionId_fkey" .* DEFERRABLE INITIALLY DEFERRED;/);
    const check = functionBody(CODE, "waiver_ai_competitive_override_check");
    expect(check).toMatch(/s\."submittedAt" = NEW\."authorizedAt" AND s\."lockedAt" = NEW\."authorizedAt"/);
    expect(check).toMatch(/r\."createdAt" = NEW\."authorizedAt" AND r\."authorUserId" = NEW\."authorizedByUserId"/);
    expect(check).toMatch(/"waiver_revision_call_fingerprint"\(NEW\."revisionId"\) IS DISTINCT FROM NEW\."boardFingerprint"/);
    expect(check).toMatch(/a\."promptVersion" IS NULL AND a\."promptSha256" IS NULL AND a\."statedGeneratedAt" IS NULL/);
    expect(check).toMatch(/a\."responseSha256" = NEW\."responseSha256"/);
    expect(check).toMatch(/'WAIVER_INVALID: a board has at most one post-lock authorization'/);
  });
});
