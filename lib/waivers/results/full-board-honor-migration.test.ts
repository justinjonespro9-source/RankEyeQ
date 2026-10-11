import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const read = (name: string) => readFileSync(path.join(ROOT, "prisma/migrations", name, "migration.sql"), "utf8");
const uncommented = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
const STORAGE = uncommented(read("20261008000000_waivers_grading_results_storage"));
const CODE = uncommented(read("20261012000000_waivers_full_board_honor_scoreable_slots"));
const GUARD = "waiver_board_grade_guard";
const COMPLETE = "waiver_board_grade_complete_check";

function functionBody(sql: string, name: string): string[] {
  const start = sql.search(new RegExp(`^CREATE (OR REPLACE )?FUNCTION "${name}"\\(\\)`, "m"));
  expect(start, name).toBeGreaterThan(-1);
  return sql
    .slice(sql.indexOf("\n", start) + 1, sql.indexOf("$$;", start))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Line diff (longest common subsequence) of trimmed lines. */
function lineDiff(before: string[], after: string[]) {
  const lcs = before.map(() => new Array<number>(after.length + 1).fill(0));
  lcs.push(new Array<number>(after.length + 1).fill(0));
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      i += 1;
      j += 1;
    } else if (j < after.length && (i === before.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      added.push(after[j++]);
    } else {
      removed.push(before[i++]);
    }
  }
  return { removed, added };
}

describe("Stage 4B.4 full-board honor migration (static)", () => {
  it("only replaces the two board-grade honor functions: no tables, constraints, triggers, privileges or data", () => {
    expect([...CODE.matchAll(/^CREATE OR REPLACE FUNCTION "(\w+)"/gm)].map((match) => match[1])).toEqual([GUARD, COMPLETE]);
    expect(CODE.match(/^\s*CREATE\b/gim)).toHaveLength(2);
    expect(CODE).not.toMatch(/\bGRANT\b|\bREVOKE\b|\bDROP\b|\bALTER\b|\bTRUNCATE\b|DISABLE TRIGGER|SECURITY DEFINER|CONSTRAINT|CHECK \(/i);
    expect(CODE).not.toMatch(/^\s*(INSERT INTO|UPDATE "|DELETE FROM)/im);
    expect(CODE).not.toMatch(/current_setting|set_config|SET LOCAL|SET SESSION|session_replication_role/i);
  });

  it("keeps every board-guard check and only relaxes the insert-time honor test to the honor kinds of the field", () => {
    const { removed, added } = lineDiff(functionBody(STORAGE, GUARD), functionBody(CODE, GUARD));
    expect(removed).toEqual([
      "v_expected_honor text;",
      "v_expected_honor := CASE",
      `WHEN NEW."resultKind" <> 'SCORED' OR NEW."scoreableCallCount" = 0 OR NEW."exactCallCount" <> NEW."scoreableCallCount" THEN NULL`,
      `WHEN NEW."neutralizedCallCount" = 0 AND NEW."exactCallCount" = v_result."resultFieldSize" THEN`,
      "CASE v_result.\"resultFieldSize\" WHEN 3 THEN 'PERFECT_PODIUM' WHEN 5 THEN 'PERFECT_FIVE' END",
      "ELSE 'PERFECT_CALL' END;",
      `IF NEW."awardedHonor"::text IS DISTINCT FROM v_expected_honor THEN`,
      "RAISE EXCEPTION 'WAIVER_INVALID: awarded honor must follow the Stage 4A honor rules';",
    ]);
    expect(added).toEqual([
      "v_honor_ok boolean;",
      `IF NEW."resultKind" <> 'SCORED' OR NEW."scoreableCallCount" = 0 OR NEW."exactCallCount" <> NEW."scoreableCallCount" THEN`,
      `v_honor_ok := NEW."awardedHonor" IS NULL;`,
      "ELSE",
      `v_honor_ok := NEW."awardedHonor"::text IN ('PERFECT_CALL',`,
      "CASE v_result.\"resultFieldSize\" WHEN 3 THEN 'PERFECT_PODIUM' WHEN 5 THEN 'PERFECT_FIVE' END);",
      "END IF;",
      "IF v_honor_ok IS NOT TRUE THEN",
      "RAISE EXCEPTION 'WAIVER_INVALID: awarded honor must follow the Waiver honor rules';",
    ]);
  });

  it("keeps the commit-time call-sum check and settles the exact honor on the contest's scoreable slots", () => {
    const before = functionBody(STORAGE, COMPLETE);
    const after = functionBody(CODE, COMPLETE);
    const { removed, added } = lineDiff(before, after);
    expect(removed).toEqual([]);
    expect(added.slice(0, 4)).toEqual(["v_result \"WaiverContestResult\"%ROWTYPE;", "v_neutralized_members int;", "v_scoreable_slots int;", "v_expected_honor text;"]);
    const honor = added.slice(4).join("\n");
    expect(honor).toBe(
      [
        `SELECT * INTO v_result FROM "WaiverContestResult" r WHERE r."id" = v_board."contestResultId";`,
        `SELECT count(*) INTO v_neutralized_members FROM "WaiverPoolResult" p`,
        `WHERE p."contestResultId" = v_result."id" AND p."category" = 'ELIGIBLE_POOL_MEMBER' AND p."treatment" = 'NEUTRALIZED';`,
        `v_scoreable_slots := greatest(least(v_result."effectiveAvailableSlots", v_result."eligiblePoolSize" - v_neutralized_members), 0);`,
        "v_expected_honor := CASE",
        `WHEN v_board."resultKind" <> 'SCORED' OR v_board."scoreableCallCount" = 0`,
        `OR v_board."exactCallCount" <> v_board."scoreableCallCount" THEN NULL`,
        `WHEN v_board."neutralizedCallCount" = 0 AND v_board."exactCallCount" = v_board."submittedCallCount"`,
        `AND v_scoreable_slots > 0 AND v_board."exactCallCount" = v_scoreable_slots THEN`,
        "CASE v_result.\"resultFieldSize\" WHEN 3 THEN 'PERFECT_PODIUM' WHEN 5 THEN 'PERFECT_FIVE' END",
        "ELSE 'PERFECT_CALL' END;",
        `IF v_board."awardedHonor"::text IS DISTINCT FROM v_expected_honor THEN`,
        "RAISE EXCEPTION 'WAIVER_INVALID: awarded honor must follow the Waiver honor rules';",
        "END IF;",
      ].join("\n"),
    );
    // The honor block runs after the call-sum check and before the final RETURN.
    expect(after.indexOf("RAISE EXCEPTION 'WAIVER_INVALID: a board grade must equal the sum of its call grades';")).toBeLessThan(
      after.indexOf("v_expected_honor := CASE"),
    );
    expect(after.at(-2)).toBe("RETURN NULL;");
  });

  it("leaves the board shape check, triggers and deferral that the honor rule relies on in place", () => {
    expect(STORAGE).toMatch(/AND \("awardedHonor" IS NULL OR \("honorEligible" AND "exactCallCount" = "scoreableCallCount"\)\)/);
    expect(STORAGE).toMatch(/AND \("awardedHonor" IS NULL OR "awardedHonor" = 'PERFECT_CALL'\n\s+OR \("neutralizedCallCount" = 0 AND "exactCallCount" = "submittedCallCount"\)\)/);
    expect(STORAGE).toMatch(/CREATE CONSTRAINT TRIGGER "WaiverBoardGrade_complete"\n {2}AFTER INSERT ON "WaiverBoardGrade"\n {2}DEFERRABLE INITIALLY DEFERRED/);
    expect(STORAGE).toMatch(/CREATE CONSTRAINT TRIGGER "WaiverCallGrade_complete"\n {2}AFTER INSERT ON "WaiverCallGrade"\n {2}DEFERRABLE INITIALLY DEFERRED/);
    expect(STORAGE).toMatch(/CREATE TRIGGER "WaiverBoardGrade_guard"\n {2}BEFORE INSERT OR UPDATE OR DELETE ON "WaiverBoardGrade"/);
  });
});
