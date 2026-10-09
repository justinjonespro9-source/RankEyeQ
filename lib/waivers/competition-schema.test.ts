import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCHEMA = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
const MIGRATION = "20261001000000_waivers_competition_foundation";
const MIGRATION_SQL = readFileSync(path.join(ROOT, "prisma/migrations", MIGRATION, "migration.sql"), "utf8");

const MODELS = ["WaiverCall", "WaiverContest", "WaiverSubmission", "WaiverSubmissionRevision"];

function block(kind: "model" | "enum", name: string): string {
  const match = SCHEMA.match(new RegExp(`^${kind}\\s+${name}\\s*\\{([\\s\\S]*?)^\\}`, "m"));
  if (!match) throw new Error(`${kind} ${name} not found`);
  return match[1];
}

const FUNCTION_BODY_RE = /\$\$[\s\S]*?\$\$/g;
const functionBodies = [...MIGRATION_SQL.matchAll(FUNCTION_BODY_RE)].map((m) => m[0]);

function statements(sql: string): string[] {
  return sql
    .replace(FUNCTION_BODY_RE, () => "$$BODY$$")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

describe("Waiver competition schema (static)", () => {
  it("declares exactly the approved enums", () => {
    const values = (name: string) => block("enum", name).trim().split(/\s+/);
    expect(values("WaiverContestStatus")).toEqual(["OPEN", "LOCKED"]);
    expect(values("WaiverSubmissionStatus")).toEqual(["DRAFT", "SUBMITTED", "LOCKED"]);
    expect(values("WaiverRevisionKind")).toEqual(["DRAFT", "SUBMISSION"]);
  });

  it("every competition foreign key is onDelete: Restrict", () => {
    const relationLines = MODELS.flatMap((name) =>
      block("model", name)
        .split("\n")
        .filter((line) => /@relation\([^)]*fields:/.test(line)),
    );
    expect(relationLines).toHaveLength(13);
    for (const line of relationLines) expect(line).toMatch(/onDelete:\s*Restrict/);
    for (const name of MODELS) expect(block("model", name)).not.toMatch(/onDelete:\s*(Cascade|SetNull|SetDefault|NoAction)/);
  });

  it("declares the integrity uniques", () => {
    expect(block("model", "WaiverContest")).toMatch(/@@unique\(\[weekId, position\]\)/);
    const submission = block("model", "WaiverSubmission");
    expect(submission).toMatch(/@@unique\(\[contestId, universalProfileId\]\)/);
    // One owner-authored board per login; admins may operate many AI boards per contest.
    expect(submission).toMatch(
      /@@unique\(\[contestId, createdByUserId\], map: "WaiverSubmission_contestId_createdByUserId_owner_key", where: raw\("authority = 'OWNER_AUTHORED'::\\"SubmissionAuthority\\""\)\)/,
    );
    expect(submission).not.toMatch(/@@unique\(\[contestId, createdByUserId\]\)/);
    expect(submission).toMatch(/currentRevisionId\s+String\?\s+@unique/);
    expect(submission).toMatch(/lockedRevisionId\s+String\?\s+@unique/);
    expect(block("model", "WaiverSubmissionRevision")).toMatch(/@@unique\(\[submissionId, revisionNumber\]\)/);
    const call = block("model", "WaiverCall");
    expect(call).toMatch(/@@unique\(\[revisionId, slot\]\)/);
    expect(call).toMatch(/@@unique\(\[revisionId, snapshotEntryId\]\)/);
  });

  it("board authority is recorded, not hard-wired to owner-authored (future RankEyeQ-operated boards remain possible)", () => {
    const submission = block("model", "WaiverSubmission");
    expect(submission).toMatch(/authority\s+SubmissionAuthority\b/);
    expect(submission).not.toMatch(/authority\s+SubmissionAuthority\s+@default/);
  });

  it("stores no grading, result, or correction-treatment fields (Phase 3 decisions)", () => {
    // Back-relations to the Stage 4B.3 grading tables are virtual (no columns on these tables).
    const gradingBackRelation = /^\s*\w+\s+Waiver(ContestResult|ConflictResolution|BoardGrade|CallGrade|ContestResultAuthority|BoardGradeAuthority)(\[\]|\?)\s*$/;
    for (const name of MODELS) {
      const stored = block("model", name)
        .split("\n")
        .filter((line) => !gradingBackRelation.test(line))
        .join("\n");
      expect(stored).not.toMatch(/\b(earned|points|eyeq|grade|graded|score|result(?!FieldSize)|excluded|voided|replacement)\w*\s/i);
    }
  });
});

describe("Waiver competition migration is additive and self-contained", () => {
  const stmts = statements(MIGRATION_SQL);

  it("contains only Waiver-scoped CREATE / ADD CONSTRAINT / function / trigger statements", () => {
    const allowed = [
      /^CREATE TYPE "Waiver\w+" AS ENUM \(/,
      /^CREATE TABLE "Waiver\w+" \(/,
      /^CREATE (UNIQUE )?INDEX "Waiver\w+" ON "Waiver\w+"\(/,
      /^ALTER TABLE "Waiver\w+" ADD CONSTRAINT "Waiver\w+" FOREIGN KEY \("\w+"\) REFERENCES "\w+"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE$/,
      /^ALTER TABLE "Waiver\w+" ADD CONSTRAINT "Waiver\w+_check" CHECK \(/,
      /^CREATE FUNCTION "waiver_\w+"\(\) RETURNS (trigger|timestamp|boolean) LANGUAGE (plpgsql|sql)( VOLATILE| STABLE)? AS \$\$BODY\$\$$/,
      /^CREATE TRIGGER "Waiver\w+_guard" BEFORE INSERT OR UPDATE OR DELETE ON "Waiver\w+" FOR EACH ROW EXECUTE FUNCTION "waiver_\w+"\(\)$/,
      /^CREATE CONSTRAINT TRIGGER "Waiver\w+_shape" AFTER INSERT ON "Waiver\w+" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "waiver_revision_shape_check"\(\)$/,
    ];
    expect(stmts.filter((s) => !allowed.some((re) => re.test(s)))).toEqual([]);
    expect(stmts.filter((s) => s.startsWith("CREATE TYPE"))).toHaveLength(3);
    expect(stmts.filter((s) => s.startsWith("CREATE TABLE"))).toHaveLength(4);
    expect(stmts.filter((s) => / FOREIGN KEY /.test(s))).toHaveLength(13);
    expect(stmts.filter((s) => / CHECK \(/.test(s))).toHaveLength(6);
    expect(stmts.filter((s) => /^CREATE TRIGGER/.test(s))).toHaveLength(4);
    expect(stmts.filter((s) => /^CREATE CONSTRAINT TRIGGER/.test(s))).toHaveLength(2);
  });

  it("never alters existing tables, drops, renames, or writes data", () => {
    const outside = stmts
      .join(";\n")
      .replace(/BEFORE INSERT OR UPDATE OR DELETE ON/g, "")
      .replace(/AFTER INSERT ON/g, "");
    expect(outside).not.toMatch(/\b(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+"|INSERT|RENAME|ALTER\s+COLUMN|ALTER\s+TYPE)\b/i);
    expect(outside).not.toMatch(/ALTER TABLE "(?!Waiver)/);
    expect(outside).not.toMatch(/ON DELETE (CASCADE|SET NULL|SET DEFAULT|NO ACTION)/i);
  });

  it("trigger functions only read and raise; they never write rows", () => {
    expect(functionBodies.length).toBe(7);
    for (const body of functionBodies) {
      expect(body).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+"?\w+"?\s+SET|DELETE\s+FROM|TRUNCATE|DROP|ALTER)\b/i);
    }
  });

  it("uses the UTC clock helper, never now()/CURRENT_TIMESTAMP, inside guards", () => {
    for (const body of functionBodies) expect(body).not.toMatch(/\b(now\(\)|CURRENT_TIMESTAMP|LOCALTIMESTAMP)\b/i);
    expect(MIGRATION_SQL).toMatch(/clock_timestamp\(\) AT TIME ZONE 'UTC'/);
  });

  it("documents the fixture-maintenance switch, which never bypasses INSERT checks or append-only UPDATE bans", () => {
    expect(MIGRATION_SQL).toMatch(/rankeyeq\.waiver_fixture_maintenance/);
    expect(MIGRATION_SQL).toMatch(/^--.*maintenance/im);
  });
});
