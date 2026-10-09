import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const read = (name: string) => readFileSync(path.join(ROOT, "prisma/migrations", name, "migration.sql"), "utf8");
const FOUNDATION = read("20261001000000_waivers_competition_foundation");
const AI_PARTICIPATION = read("20261009000000_waivers_ai_participation");
const SQL = read("20261010000000_waivers_ai_late_entry");
const CODE = SQL.split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const NEW_TABLES = ["WaiverAiLateEntryVerification", "WaiverAiLateEntryApproval"];
/** The only change to an existing table: a late entry whose original prompt is not verified canonical stores no prompt. */
const RESPONSE_PROMPT_NULLABLE = 'ALTER TABLE "WaiverAiResponse" ALTER COLUMN "promptVersion" DROP NOT NULL,\nALTER COLUMN "promptSha256" DROP NOT NULL;';
const NEW_CODE = CODE.replace(RESPONSE_PROMPT_NULLABLE, "");
const REDECLARED = ["waiver_submission_guard", "waiver_revision_guard", "waiver_call_guard", "waiver_ai_response_guard"];

function functionBody(sql: string, name: string): string[] {
  const start = sql.search(new RegExp(`^CREATE (OR REPLACE )?FUNCTION "${name}"\\(\\)`, "m"));
  expect(start, name).toBeGreaterThan(-1);
  const end = sql.indexOf("$$;", start);
  return sql
    .slice(sql.indexOf("\n", start) + 1, end)
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

describe("Stage 4B.3B late-entry migration (static)", () => {
  it("never changes contest lock times, privileges, trigger enablement or existing data", () => {
    expect(CODE.split(RESPONSE_PROMPT_NULLABLE)).toHaveLength(2);
    expect(NEW_CODE).not.toMatch(/\bGRANT\b|\bREVOKE\b|DISABLE TRIGGER|DROP TRIGGER|DROP FUNCTION|\bDROP\b|ALTER TYPE|ALTER COLUMN|SECURITY DEFINER/i);
    expect(CODE).not.toMatch(/^\s*(INSERT INTO|UPDATE "|DELETE FROM)/im);
    expect(CODE).not.toMatch(/"locksAt"\s*:?=/);
    expect(CODE).not.toMatch(/ON DELETE (CASCADE|SET NULL|SET DEFAULT|NO ACTION)/i);
    const alteredTables = [...NEW_CODE.matchAll(/ALTER TABLE "(\w+)"/g)].map((match) => match[1]);
    expect(new Set(alteredTables)).toEqual(new Set(NEW_TABLES));
  });

  it("lets an AI response omit its prompt only on a same-transaction approved late entry, never a canonical claim", () => {
    const guard = functionBody(CODE, "waiver_ai_response_prompt_guard").join("\n");
    expect(guard).toMatch(/IF NEW\."promptVersion" IS NOT NULL AND NEW\."promptSha256" IS NOT NULL THEN\nRETURN NEW;/);
    expect(guard).toMatch(/"waiver_ai_late_entry_in_transaction"\(v_submission\)/);
    expect(guard).toMatch(/IF NOT FOUND OR v_late\."revisionId" <> NEW\."revisionId" THEN\nRAISE EXCEPTION 'WAIVER_INVALID: an AI Waiver response records the prompt it answered';/);
    expect(CODE).toMatch(/CREATE TRIGGER "WaiverAiResponse_prompt_guard"\n {2}BEFORE INSERT ON "WaiverAiResponse"/);
    const commit = functionBody(CODE, "waiver_ai_late_entry_approval_check").join("\n");
    expect(commit).toMatch(/a\."promptVersion" IS NOT DISTINCT FROM \(CASE WHEN v\."promptEquivalence" = 'VERIFIED' THEN v\."canonicalPromptVersion" END\)/);
    expect(commit).toMatch(/a\."promptSha256" IS NOT DISTINCT FROM \(CASE WHEN v\."promptEquivalence" = 'VERIFIED' THEN v\."canonicalPromptSha256" END\)/);
    const verification = functionBody(CODE, "waiver_ai_late_entry_verification_guard").join("\n");
    expect(verification).toMatch(/RAISE EXCEPTION 'WAIVER_INVALID: a canonical prompt version requires the byte-identical preserved prompt text'/);
    expect(verification).toMatch(/NEW\."promptEquivalence" := 'VERIFIED'/);
  });

  it("derives provider-file containment, time and method from the stored bytes", () => {
    const verification = functionBody(CODE, "waiver_ai_late_entry_verification_guard").join("\n");
    expect(verification).toMatch(/NEW\."artifactContainsResponse" := CASE WHEN NEW\."sourceArtifact" IS NULL THEN NULL/);
    expect(verification).toMatch(/"waiver_ai_artifact_message_time"\(NEW\."sourceArtifact", v_evidence\."responseText"\)/);
    expect(verification).toMatch(/NEW\."timestampMethod" := 'PROVIDER_MESSAGE'/);
    expect(verification).toMatch(/NEW\."timestampMethod" := 'ADMIN_READ_FROM_ARTIFACT'/);
    expect(verification).toMatch(/WHEN NEW\."basis" = 'PROVIDER_ARTIFACT' AND NEW\."timestampMethod" <> 'PROVIDER_MESSAGE' THEN 'NO_PROVIDER_MESSAGE_TIME'/);
    expect(verification).toMatch(/'WAIVER_INVALID: an original prediction time cannot be in the future'/);
    expect(verification).toMatch(/'WAIVER_INVALID: the entered time conflicts with the provider message timestamp'/);
  });

  it("has no session flag or setting that could switch off a lock", () => {
    expect(CODE).not.toMatch(/current_setting|set_config|SET LOCAL|SET SESSION|session_replication_role/i);
    expect([...CODE.matchAll(/CREATE OR REPLACE FUNCTION "(\w+)"/g)].map((match) => match[1])).toEqual(REDECLARED);
  });

  it("re-declares each lock guard with only the approval-in-this-transaction branch added", () => {
    const original = (name: string) => functionBody(name === "waiver_ai_response_guard" ? AI_PARTICIPATION : FOUNDATION, name);
    const diffs = Object.fromEntries(REDECLARED.map((name) => [name, lineDiff(original(name), functionBody(CODE, name))]));

    expect(diffs.waiver_submission_guard.removed).toEqual([]);
    expect(diffs.waiver_revision_guard.removed).toEqual(['IF "waiver_utc_now"() >= v_locks OR NEW."createdAt" >= v_locks THEN']);
    expect(diffs.waiver_call_guard.removed).toEqual(['SELECT c."locksAt", c."position", c."maxCalls", r."snapshotId" INTO v_locks, v_position, v_max, v_snapshot']);
    expect(diffs.waiver_ai_response_guard.removed).toEqual([
      'c."position", c."snapshotId", c."locksAt"',
      "INTO v_kind, v_call_count, v_revision_snapshot, v_author, v_authority, v_contest, v_profile, v_position, v_pinned, v_locks",
    ]);

    const structural = new Set([
      "END IF;",
      "RETURN NEW;",
      'ELSIF "waiver_utc_now"() >= v_locks OR NEW."createdAt" >= v_locks THEN',
      `IF FOUND AND OLD."status" = 'DRAFT' AND OLD."currentRevisionId" IS NULL AND OLD."lockedRevisionId" IS NULL`,
      'AND OLD."submittedAt" IS NULL AND OLD."lockedAt" IS NULL',
      'c."position", c."snapshotId", c."locksAt", s."id"',
      "RAISE EXCEPTION 'WAIVER_INVALID: a late-entered Waiver revision must match its approval exactly';",
    ]);
    for (const [name, diff] of Object.entries(diffs)) {
      for (const line of diff.added) {
        expect(/v_late|v_submission/.test(line) || structural.has(line), `${name}: ${line}`).toBe(true);
      }
    }
  });

  it("admits a post-lock write only through an approval inserted by the current transaction", () => {
    const helper = CODE.slice(CODE.indexOf('CREATE FUNCTION "waiver_ai_late_entry_in_transaction"'), CODE.indexOf("$$;", CODE.indexOf('CREATE FUNCTION "waiver_ai_late_entry_in_transaction"')));
    expect(helper).toMatch(/"waiver_xmin_is_current_transaction"\(a\.xmin::text::bigint\)/);
    for (const name of REDECLARED) {
      const body = functionBody(CODE, name).join("\n");
      // The submission guard covers both the INSERT and the DRAFT -> LOCKED update.
      expect(body.match(/"waiver_ai_late_entry_in_transaction"/g), name).toHaveLength(name === "waiver_submission_guard" ? 2 : 1);
      expect(body, name).toMatch(/WAIVER_LOCKED/);
    }
  });

  it("makes verifications and approvals append-only, admin-only and bound to evidence", () => {
    for (const trigger of [
      '"WaiverAiLateEntryVerification_guard"',
      '"WaiverAiLateEntryApproval_guard"',
      'CONSTRAINT TRIGGER "WaiverAiLateEntryApproval_board"',
      '"WaiverAiLateEntryVerification_no_truncate"',
      '"WaiverAiLateEntryApproval_no_truncate"',
    ]) {
      expect(CODE, trigger).toContain(trigger);
    }
    expect(CODE).toMatch(/'WAIVER_IMMUTABLE: AI late-entry verifications are append-only'/);
    expect(CODE).toMatch(/'WAIVER_IMMUTABLE: AI late-entry approvals are immutable'/);
    expect(CODE).toMatch(/"waiver_require_admin"\(NEW\."verifiedByUserId"/);
    expect(CODE).toMatch(/"waiver_require_admin"\(NEW\."approvedByUserId"/);
    expect(CODE).toMatch(/WHEN NEW\."basis" = 'OPERATOR_ATTESTED' THEN 'OPERATOR_ATTESTED_ONLY'/);
    expect(CODE).toMatch(/'WAIVER_INVALID: a late entry is approved in a separate action from its verification'/);
    expect(CODE).toMatch(/CREATE UNIQUE INDEX "WaiverAiLateEntryApproval_contestId_universalProfileId_key"/);
    expect(CODE).toMatch(/CREATE UNIQUE INDEX "WaiverAiLateEntryApproval_verificationId_key"/);
    for (const fk of ["submissionId", "revisionId"]) {
      expect(CODE, fk).toMatch(new RegExp(`"WaiverAiLateEntryApproval_${fk}_fkey" FOREIGN KEY \\("${fk}"\\) .* ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;`));
    }
  });
});
