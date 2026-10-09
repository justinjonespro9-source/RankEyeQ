import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const SQL = readFileSync(path.join(ROOT, "prisma/migrations/20261009000000_waivers_ai_participation/migration.sql"), "utf8");
const CODE = SQL.split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const NEW_TABLES = ["WaiverAiResponse", "WaiverAiHistoricalEvidence", "WaiverAiHistoricalEvidenceReview"];

describe("Stage 4B.3A AI participation migration (static)", () => {
  it("replaces the per-login unique with an owner-only partial unique, created before the old index is dropped", () => {
    const created = CODE.indexOf('CREATE UNIQUE INDEX "WaiverSubmission_contestId_createdByUserId_owner_key"');
    const dropped = CODE.indexOf('DROP INDEX "WaiverSubmission_contestId_createdByUserId_key"');
    expect(created).toBeGreaterThan(-1);
    expect(dropped).toBeGreaterThan(created);
    expect(CODE).toMatch(/"WaiverSubmission_contestId_createdByUserId_owner_key" ON "WaiverSubmission"\("contestId", "createdByUserId"\) WHERE \(authority = 'OWNER_AUTHORED'::"SubmissionAuthority"\)/);
    expect(CODE.match(/\bDROP\b/g)).toHaveLength(1);
    // A blocking build inside the migration's single implicit transaction leaves no window without an owner unique.
    expect(CODE).not.toMatch(/CONCURRENTLY|^\s*(BEGIN|COMMIT|START TRANSACTION)\s*;/im);
  });

  it("never redefines, disables or alters existing Waiver objects, privileges or data", () => {
    expect(CODE).not.toMatch(/CREATE OR REPLACE|DISABLE TRIGGER|DROP TRIGGER|DROP FUNCTION|\bGRANT\b|\bREVOKE\b|ALTER TYPE|ALTER COLUMN/i);
    const alteredTables = [...CODE.matchAll(/ALTER TABLE "(\w+)"/g)].map((match) => match[1]);
    expect(new Set(alteredTables)).toEqual(new Set(NEW_TABLES));
    expect(CODE).not.toMatch(/^\s*(INSERT INTO|UPDATE "|DELETE FROM)/im);
    expect(CODE).not.toMatch(/ON DELETE (CASCADE|SET NULL|SET DEFAULT|NO ACTION)/i);
  });

  it("guards authority, response presence, immutability and append-only evidence in the database", () => {
    for (const trigger of [
      '"WaiverSubmission_authority_guard"',
      '"WaiverSubmissionRevision_authority_guard"',
      'CONSTRAINT TRIGGER "WaiverSubmissionRevision_ai_response"',
      'CONSTRAINT TRIGGER "WaiverSubmission_ai_shape"',
      '"WaiverAiResponse_guard"',
      '"WaiverAiHistoricalEvidence_guard"',
      '"WaiverAiHistoricalEvidenceReview_guard"',
      '"WaiverAiResponse_no_truncate"',
      '"WaiverAiHistoricalEvidence_no_truncate"',
      '"WaiverAiHistoricalEvidenceReview_no_truncate"',
    ]) {
      expect(CODE, trigger).toContain(trigger);
    }
    expect(CODE).toMatch(/encode\(sha256\(convert_to\("responseText", 'UTF8'\)\), 'hex'\)/);
    expect(CODE).toMatch(/"?waiver_utc_now"?\(\)/);
    expect(CODE).toMatch(/DEFERRABLE INITIALLY DEFERRED/);
  });

  it("evidence guards only read other tables and never write competitive records", () => {
    for (const name of ["waiver_ai_evidence_guard", "waiver_ai_evidence_review_guard"]) {
      const start = CODE.indexOf(`CREATE FUNCTION "${name}"()`);
      const body = CODE.slice(start, CODE.indexOf("$$;", start));
      expect(start, name).toBeGreaterThan(-1);
      expect(body, name).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM|TRUNCATE)\b/i);
      expect(body, name).not.toMatch(/"WaiverSubmission|"WaiverCall"/);
    }
  });
});

describe("historical evidence isolation (static)", () => {
  const SCHEMA = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
  const model = (name: string) => SCHEMA.match(new RegExp(`^model ${name} \\{[\\s\\S]*?^\\}`, "m"))?.[0] ?? "";

  it("evidence has no relation to submissions, revisions, calls or responses; only a late-entry approval or an admin override links them", () => {
    for (const name of ["WaiverAiHistoricalEvidence", "WaiverAiHistoricalEvidenceReview", "WaiverAiLateEntryVerification"]) {
      expect(model(name), name).not.toMatch(/\bWaiverSubmission\b|\bWaiverSubmissionRevision\b|\bWaiverCall\b|\bWaiverAiResponse\b/);
    }
    const referencing = [...SCHEMA.matchAll(/^model (\w+) \{[\s\S]*?^\}/gm)]
      .filter((match) => /\sWaiverAiHistoricalEvidence\??\s+@relation\(fields:/.test(match[0]))
      .map((match) => match[1]);
    expect(referencing.sort()).toEqual(["WaiverAiCompetitiveOverride", "WaiverAiHistoricalEvidenceReview", "WaiverAiLateEntryApproval", "WaiverAiLateEntryVerification"]);
  });

  it("only the AI evidence, late-entry and admin query modules read or write evidence", () => {
    const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "app", "lib", "components"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter((file) => /\.(ts|tsx)$/.test(file) && !file.startsWith("lib/generated/") && !/\.test\.tsx?$/.test(file) && !file.includes("__fixtures__"));
    const touching = files.filter((file) => /waiverAiHistoricalEvidence/.test(readFileSync(path.join(ROOT, file), "utf8")));
    expect(touching.sort()).toEqual(["lib/waivers/ai/evidence.ts", "lib/waivers/ai/late-entry.ts", "lib/waivers/ai/queries.ts"]);
    const lateEntrySource = readFileSync(path.join(ROOT, "lib/waivers/ai/late-entry.ts"), "utf8");
    expect(lateEntrySource).not.toMatch(/\.waiverAiHistoricalEvidence(Review)?\.(create|update|upsert|delete)/);
    const evidenceSource = readFileSync(path.join(ROOT, "lib/waivers/ai/evidence.ts"), "utf8");
    expect(evidenceSource).not.toMatch(/\.(waiverSubmission|waiverSubmissionRevision|waiverCall|waiverAiResponse|waiverContest|waiverSnapshot\w*)\.(create|update|upsert|delete)/);
  });
});
