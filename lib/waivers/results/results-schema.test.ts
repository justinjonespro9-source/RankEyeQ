import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SQL = readFileSync(path.join(ROOT, "prisma/migrations/20261008000000_waivers_grading_results_storage/migration.sql"), "utf8");
const SCHEMA = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");

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

const body = (name: string) => SQL.match(new RegExp(`FUNCTION "${name}"\\([^)]*\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`))![1];
const block = (kind: "model" | "enum", name: string) => SCHEMA.match(new RegExp(`^${kind} ${name} \\{([\\s\\S]*?)^\\}`, "m"))?.[1] ?? null;

const TABLES = [
  "WaiverConflictResolution",
  "WaiverContestResult",
  "WaiverPoolResult",
  "WaiverGradeRun",
  "WaiverEmptyPositionResult",
  "WaiverBoardGrade",
  "WaiverCallGrade",
  "WaiverGradeApproval",
  "WaiverGradeAuthorityChange",
  "WaiverWeekGradeAuthority",
  "WaiverContestResultAuthority",
  "WaiverBoardGradeAuthority",
];
const IMMUTABLE_GUARDS = [
  "waiver_conflict_resolution_guard",
  "waiver_contest_result_guard",
  "waiver_pool_result_guard",
  "waiver_empty_position_result_guard",
  "waiver_grade_run_guard",
  "waiver_board_grade_guard",
  "waiver_call_grade_guard",
  "waiver_grade_approval_guard",
  "waiver_grade_authority_change_guard",
];
const T = `"(${TABLES.join("|")})"`;

describe("Stage 4B.3 results and grading migration (static)", () => {
  const all = statements(SQL);

  it("is additive: enums, twelve tables, indexes, Restrict FKs, CHECKs, functions and triggers on new objects only", () => {
    const kinds = [
      [/^CREATE TYPE "Waiver\w+" AS ENUM \(/, 13],
      [new RegExp(`^CREATE TABLE ${T} \\(`), 12],
      [new RegExp(`^CREATE UNIQUE INDEX "\\w+" ON ${T}\\(`), 17],
      [new RegExp(`^CREATE INDEX "\\w+" ON ${T}\\(`), 44],
      [new RegExp(`^ALTER TABLE ${T} ADD CONSTRAINT "\\w+_fkey" FOREIGN KEY \\([^)]+\\) REFERENCES "\\w+"\\("\\w+"\\) ON DELETE RESTRICT ON UPDATE CASCADE$`), 57],
      [new RegExp(`^ALTER TABLE ${T} ADD CONSTRAINT "\\w+_check" CHECK \\(`), 15],
      [/^CREATE FUNCTION "waiver_\w+"\([^)]*\) RETURNS (text|void|boolean) LANGUAGE (sql|plpgsql)/, 6],
      [/^CREATE FUNCTION "waiver_\w+"\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$BODY\$\$$/, 15],
      [new RegExp(`^CREATE TRIGGER "\\w+_guard" BEFORE INSERT OR UPDATE OR DELETE ON ${T} FOR EACH ROW EXECUTE FUNCTION`), 12],
      [new RegExp(`^CREATE TRIGGER "\\w+_no_truncate" BEFORE TRUNCATE ON ${T} FOR EACH STATEMENT EXECUTE FUNCTION "waiver_grading_truncate_guard"\\(\\)$`), 12],
      [new RegExp(`^CREATE CONSTRAINT TRIGGER "\\w+" AFTER INSERT( OR UPDATE)? ON ${T} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION`), 9],
    ] as const;
    for (const [re, count] of kinds) expect(all.filter((s) => re.test(s)).length, String(re)).toBe(count);
    expect(all.length).toBe(kinds.reduce((sum, [, count]) => sum + count, 0));
  });

  it("never drops, rewrites, backfills, or alters existing tables (no Rankings, competition or artifact changes)", () => {
    expect(SQL).not.toMatch(/\b(DROP|INSERT\s+INTO|RENAME|ALTER\s+COLUMN|ALTER\s+TYPE|CREATE\s+OR\s+REPLACE)\b/i);
    expect(SQL).not.toMatch(/^\s*(TRUNCATE|DELETE\s+FROM|UPDATE\s+")/im);
    expect(SQL).not.toMatch(/ON DELETE (CASCADE|SET NULL|SET DEFAULT|NO ACTION)/i);
    expect(SQL).not.toMatch(/\b(GRANT|REVOKE|ALTER\s+(ROLE|DEFAULT\s+PRIVILEGES)|OWNER\s+TO)\b/i);
    for (const statement of all.filter((s) => s.startsWith("ALTER TABLE"))) expect(statement).toMatch(new RegExp(`^ALTER TABLE ${T} `));
  });

  it("stores EyeQ and FP only as integer hundredths with explicit denominators", () => {
    const hundredths = [...SQL.matchAll(/^ {4}"(\w*(?:Hundredths|RawPoints|Numerator|Denominator))" (\w+)(?: NOT NULL)?,$/gm)];
    expect(hundredths.length).toBeGreaterThanOrEqual(15);
    for (const [, column, type] of hundredths) expect(type, column).toBe("INTEGER");
    for (const table of all.filter((s) => s.startsWith("CREATE TABLE"))) expect(table).not.toMatch(/\b(NUMERIC|DECIMAL|REAL|DOUBLE PRECISION|FLOAT\d?)\b/i);
  });

  it("immutable records refuse UPDATE always and DELETE outside fixture maintenance", () => {
    for (const name of IMMUTABLE_GUARDS) {
      const fn = body(name);
      expect(fn, name).toMatch(/IF TG_OP = 'UPDATE' THEN\s+RAISE EXCEPTION 'WAIVER_IMMUTABLE:/);
      expect(fn, name).toMatch(/IF TG_OP = 'DELETE' THEN\s+IF "waiver_fixture_maintenance"\(\) THEN\s+RETURN OLD;\s+END IF;\s+RAISE EXCEPTION 'WAIVER_IMMUTABLE:/);
    }
    const pointer = body("waiver_grade_authority_pointer_guard");
    expect(pointer).toMatch(/IF TG_OP = 'DELETE' THEN\s+IF "waiver_fixture_maintenance"\(\) THEN\s+RETURN OLD;\s+END IF;\s+RAISE EXCEPTION 'WAIVER_IMMUTABLE:/);
    expect(pointer).toContain(`y."sequence" > v_change."sequence"`);
    expect(body("waiver_grading_truncate_guard")).toMatch(/IF "waiver_fixture_maintenance"\(\) THEN\s+RETURN NULL;\s+END IF;\s+RAISE EXCEPTION 'WAIVER_IMMUTABLE:/);
  });

  it("serializes week grading writes and stamps database time", () => {
    expect(body("waiver_grade_week_lock")).toContain(`pg_advisory_xact_lock(hashtextextended('waiver_grade_week:' || p_week, 0))`);
    for (const name of ["waiver_grade_run_guard", "waiver_grade_approval_guard", "waiver_grade_authority_change_guard", "waiver_grade_authority_pointer_guard"]) {
      expect(body(name), name).toContain(`PERFORM "waiver_grade_week_lock"(NEW."weekId")`);
    }
    expect(SQL).toMatch(/NEW\."approvedAt" := "waiver_utc_now"\(\)/);
    expect(SQL).toMatch(/NEW\."recordedAt" := "waiver_utc_now"\(\)/);
  });

  it("approval is separate from import, binds the exact run and enforces SEPARATE_APPROVER", () => {
    const fn = body("waiver_grade_approval_guard");
    expect(fn).toMatch(/IF "waiver_xmin_is_current_transaction"\(v_artifact_xid\) THEN\s+RAISE EXCEPTION 'WAIVER_INVALID: grading approval cannot be recorded in the artifact import transaction'/);
    // Subtransaction-safe: a row inserted under a savepoint of this transaction is also 'in progress'.
    const current = body("waiver_xmin_is_current_transaction");
    expect(current).toContain(`pg_xact_status(x.full_xid::text::xid8) IS NOT DISTINCT FROM 'in progress'`);
    expect(current).toContain(`pg_current_xact_id()::text::bigint AS cur`);
    // Widened within ±2^31 of the current xid: subtransaction xids are above the parent's.
    expect(current).toContain(`c.cur + ((p_xmin - (c.cur & 4294967295) + 6442450944) % 4294967296) - 2147483648`);
    expect(current).toContain(`WHEN p_xmin < 3 OR x.full_xid < 3 THEN false`);
    expect(SQL).not.toContain("txid_current()");
    expect(fn).toContain("cannot be downgraded to SINGLE_ADMIN_EXPLICIT");
    expect(fn).toContain(`PERFORM "waiver_require_admin"(NEW."approvedByUserId"`);
    expect(SQL).toMatch(/"approvalPolicy" <> 'SEPARATE_APPROVER'\s+OR \("approvedByUserId" <> "artifactImportedByUserId"/);
    expect(SQL).toContain(`AND "defCrosswalkAcknowledged" AND length(btrim("defCrosswalkVersion")) > 0`);
    expect(SQL).toContain(`"attestationVersion" LIKE 'rankeyeq-waiver-grading-approval/%'`);
  });

  it("week authority is checked at commit: latest change, no stale pointers, every contest of the run, every board", () => {
    const fn = body("waiver_week_grade_authority_check");
    expect(fn).toContain("stale contest or board pointer");
    expect(fn).toMatch(/IF v_contests <> num_nonnulls\(v_run\."qbContestResultId", [\s\S]*?\)\s+OR v_boards <> v_run\."boardGradeCount" THEN/);
    expect(body("waiver_grade_authority_change_guard")).toContain("requires an explicit grading approval of the exact grade run");
    expect(body("waiver_grade_authority_change_guard")).toContain("every empty position of the run to still have no contest");
  });

  it("every grade run represents all five positions: one contest result or one explicit empty-position result each", () => {
    for (const p of ["qb", "rb", "wr", "te", "def"]) {
      expect(SQL).toContain(`AND ("${p}ContestResultId" IS NULL) <> ("${p}EmptyPositionResultId" IS NULL)`);
    }
    expect(SQL).toContain(`num_nonnulls("qbContestResultId", "rbContestResultId", "wrContestResultId", "teContestResultId", "defContestResultId") >= 1`);
    expect(SQL).toContain(`AND "eligiblePoolSize" = 0 AND "resultsPolicyVersion" = 'rankeyeq-waiver-results/1'`);
    const guard = body("waiver_empty_position_result_guard");
    expect(guard).toContain(`s."status" = 'FROZEN' AND s."currentForWeekId" = NEW."weekId"`);
    expect(guard).toContain("an empty position must have no eligible candidate in the cited snapshot");
    expect(guard).toContain("a position with a Waiver contest is represented by its contest result");
  });

  it("a shrunken pool keeps the submitted board; only invalidated calls may exceed slots and coverage is capped", () => {
    expect(SQL).not.toContain(`"submittedCallCount" <= "availableSlots"`);
    expect(SQL).toContain(`AND "submittedCallCount" - "invalidatedCallCount" <= "availableSlots"`);
    expect(SQL).toContain(`AND "slotOverflow" = ("submittedCallCount" > "availableSlots")`);
    expect(SQL).toContain(`AND "effectiveAvailableSlots" = greatest("availableSlots" - "neutralizedCallCount", 0)`);
    expect(SQL).not.toContain(`AND ("scoreableCallCount" = 0 OR "effectiveAvailableSlots" > 0)`);
    expect(SQL).toContain(`AND "coverageCallCount" = least("scoreableCallCount", "effectiveAvailableSlots")`);
    expect(SQL).toContain(`"coverageModifierNumerator" = 70 * "effectiveAvailableSlots" + 30 * "coverageCallCount"`);
    // 0 only for a zero-field contest (an existing contest whose corrected pool emptied).
    expect(SQL).toContain(`AND "availableSlots" BETWEEN 0 AND 5`);
    expect(SQL).toContain(`AND "effectiveAvailableSlots" BETWEEN 0 AND least("resultFieldSize", "eligiblePoolSize")`);
    expect(body("waiver_board_grade_complete_check")).toContain(`v_invalidated <> v_board."invalidatedCallCount"`);
  });

  it("NA_NO_EFFECTIVE_SLOTS: scoreable calls without an effective slot are N/A, unplayed, honorless and carry their reason", () => {
    expect(SQL).toContain(`CREATE TYPE "WaiverBoardResultKind" AS ENUM ('SCORED', 'NA_ZERO_CALL', 'NA_ALL_NEUTRALIZED', 'NA_NO_EFFECTIVE_SLOTS')`);
    expect(SQL).toContain(`CREATE TYPE "WaiverUngradableReason" AS ENUM ('CORRECTED_POOL_EMPTY', 'NEUTRALIZATIONS_CONSUMED_SLOTS')`);
    expect(SQL).toContain(`("resultKind" = 'SCORED' AND "scoreableCallCount" > 0 AND "effectiveAvailableSlots" > 0)`);
    expect(SQL).toContain(`OR ("resultKind" = 'NA_NO_EFFECTIVE_SLOTS' AND "scoreableCallCount" > 0 AND "effectiveAvailableSlots" = 0)`);
    expect(SQL).toContain(`(CASE WHEN "availableSlots" = 0 THEN 'CORRECTED_POOL_EMPTY' ELSE 'NEUTRALIZATIONS_CONSUMED_SLOTS' END)::"WaiverUngradableReason" END`);
    expect(SQL).toContain(`AND "played" = ("resultKind" IN ('SCORED', 'NA_ZERO_CALL'))`);
    expect(SQL).toContain(`AND "honorEligible" = ("resultKind" = 'SCORED')`);
    expect(SQL).toContain(`WHEN 'NA_NO_EFFECTIVE_SLOTS' THEN 'NO_EFFECTIVE_SLOTS'`);
    expect(SQL).toContain(`CASE WHEN "scoreableCallCount" = 0 OR "effectiveAvailableSlots" = 0 THEN`);
    expect(SQL).toMatch(/"fpPerCallHundredths" IS NOT DISTINCT FROM\s+CASE WHEN "scoreableCallCount" = 0 OR "effectiveAvailableSlots" = 0 THEN NULL/);
    expect(body("waiver_board_grade_guard")).toContain(`WHEN NEW."resultKind" <> 'SCORED' OR NEW."scoreableCallCount" = 0`);
    expect(block("enum", "WaiverBoardResultKind")!.replace(/\s*\/\/\/.*$/gm, "").replace(/\s+/g, " ").trim()).toBe(
      "SCORED NA_ZERO_CALL NA_ALL_NEUTRALIZED NA_NO_EFFECTIVE_SLOTS",
    );
    expect(block("model", "WaiverBoardGrade")).toMatch(/ungradableReason\s+WaiverUngradableReason\?/);
  });

  it("validates each contest result once, set-based, and refuses pool rows its pass could not see", () => {
    const complete = body("waiver_contest_result_complete_check");
    expect(complete).toContain(`rank() OVER (ORDER BY p."fpHundredths" DESC) AS expected_rank`);
    expect(complete).toContain(`WHERE p."contestResultId" = v_result."id" AND p."treatment" = 'RANKED'`);
    expect(complete).toContain(`WHERE ranked.stored_rank IS DISTINCT FROM ranked.expected_rank`);
    expect(complete).not.toMatch(/SELECT count\(\*\) FROM "WaiverPoolResult" q/);
    expect(complete).toContain(`set_config('rankeyeq.waiver_contest_result_' || md5(v_result."id"), 'validated', true)`);
    expect(SQL).not.toContain(`CREATE CONSTRAINT TRIGGER "WaiverPoolResult_complete"`);
    expect(SQL).toMatch(/CREATE CONSTRAINT TRIGGER "WaiverContestResult_complete"\s+AFTER INSERT ON "WaiverContestResult"/);
    const pool = body("waiver_pool_result_guard");
    expect(pool).toContain(`IF NOT "waiver_xmin_is_current_transaction"(v_result_xmin)`);
    expect(pool).toContain(`current_setting('rankeyeq.waiver_contest_result_' || md5(NEW."contestResultId"), true) IS NOT DISTINCT FROM 'validated'`);
    expect(pool).toContain("pool rows must be written in the contest result''s transaction before its completeness check");
  });

  it("pins the V1 policy, ruleset and scoring versions (a new ruleset needs a migration)", () => {
    expect(SQL).toContain(`"resultsPolicyVersion" = 'rankeyeq-waiver-results/1'`);
    expect(SQL).toContain(`"gradingRulesetVersion" = 'rankeyeq-waiver-grading/1'`);
    expect(SQL).toContain(`"scoringVersion" = 'WAIVER_EYEQ_V1'`);
  });
});

describe("Stage 4B.3 Prisma models (static)", () => {
  it("declares the twelve models with every relation onDelete: Restrict", () => {
    for (const name of TABLES) {
      const model = block("model", name);
      expect(model, name).not.toBeNull();
      const lines = model!.split("\n").filter((line) => /@relation\([^)]*fields:/.test(line));
      expect(lines.length, name).toBeGreaterThan(0);
      for (const line of lines) expect(line, name).toMatch(/onDelete:\s*Restrict/);
    }
  });

  it("uniqueness rules make versions, runs, grades and the authority chain unambiguous", () => {
    expect(block("model", "WaiverConflictResolution")).toMatch(/@@unique\(\[artifactRowId, conflictKey, sequence\]\)/);
    expect(block("model", "WaiverContestResult")).toMatch(/@@unique\(\[contestId, resultVersion\]\)/);
    expect(block("model", "WaiverContestResult")).toMatch(/@@unique\(\[contestId, inputFingerprint\]\)/);
    expect(block("model", "WaiverPoolResult")).toMatch(/@@unique\(\[contestResultId, rankableEntryId\]\)/);
    expect(block("model", "WaiverEmptyPositionResult")).toMatch(/@@unique\(\[weekId, position, snapshotId\]\)/);
    expect(block("model", "WaiverGradeRun")).toMatch(/@@unique\(\[weekId, runNumber\]\)/);
    expect(block("model", "WaiverGradeRun")).toMatch(/@@unique\(\[weekId, inputFingerprint\]\)/);
    expect(block("model", "WaiverBoardGrade")).toMatch(/@@unique\(\[gradeRunId, submissionId\]\)/);
    expect(block("model", "WaiverCallGrade")).toMatch(/@@unique\(\[boardGradeId, slot\]\)/);
    expect(block("model", "WaiverGradeAuthorityChange")).toMatch(/approvalId\s+String\s+@unique/);
    expect(block("model", "WaiverGradeAuthorityChange")).toMatch(/@@unique\(\[weekId, sequence\]\)/);
    expect(block("model", "WaiverWeekGradeAuthority")).toMatch(/weekId\s+String\s+@id/);
    expect(block("model", "WaiverContestResultAuthority")).toMatch(/contestId\s+String\s+@id/);
    expect(block("model", "WaiverBoardGradeAuthority")).toMatch(/submissionId\s+String\s+@id/);
  });

  it("reuses the Stage 4A D3 vocabulary (NON_PARTICIPANT_ZERO) rather than inventing a new spelling", () => {
    const treatments = block("enum", "WaiverConflictResolutionTreatment")!.replace(/\s+/g, " ").trim();
    expect(treatments).toBe("SCORE_AS_RANKED NON_PARTICIPANT_ZERO NEUTRALIZED");
    expect(SCHEMA).not.toContain("NONPARTICIPANT_ZERO");
  });
});
