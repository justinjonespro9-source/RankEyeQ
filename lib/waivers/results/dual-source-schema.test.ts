import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static checks for the dual-source grading storage migration: a grade run and
 * its results, approval and authority pointers reference exactly one of an SNG
 * artifact or a RankEyeQ results snapshot. The database behavior (XOR, guards,
 * lifecycle) is exercised in grading/lifecycle-rankeyeq.integration.test.ts.
 */

const ROOT = process.cwd();
const SCHEMA = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
const MIGRATION = "20261021120000_waivers_dual_source_grading";
const SQL = readFileSync(path.join(ROOT, "prisma/migrations", MIGRATION, "migration.sql"), "utf8");

const modelBody = (name: string) => {
  const match = new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, "m").exec(SCHEMA);
  if (!match) throw new Error(`model ${name} not found`);
  return match[1];
};

const DUAL_SOURCE_MODELS = ["WaiverContestResult", "WaiverGradeRun", "WaiverGradeApproval", "WaiverContestResultAuthority"] as const;

describe("dual-source grading schema", () => {
  it.each(DUAL_SOURCE_MODELS)("%s has an optional artifactRowId and an optional rankEyeQSnapshotId", (name) => {
    const body = modelBody(name);
    expect(body).toMatch(/^\s*artifactRowId\s+String\?/m);
    expect(body).toMatch(/^\s*rankEyeQSnapshotId\s+String\?/m);
  });

  it.each(["WaiverContestResult", "WaiverGradeRun", "WaiverGradeApproval"] as const)("%s relates to the RankEyeQ snapshot with Restrict and an index", (name) => {
    const body = modelBody(name);
    expect(body).toMatch(/WaiverRankEyeQResultsSnapshot\?\s+@relation\(fields: \[rankEyeQSnapshotId\], references: \[id\], onDelete: Restrict\)/);
    expect(body).toMatch(/@@index\(\[rankEyeQSnapshotId\]\)/);
    expect(body).toMatch(/WaiverCanonicalArtifact\?\s+@relation\(fields: \[artifactRowId\]/);
  });

  it("wires the back relations on WaiverRankEyeQResultsSnapshot", () => {
    const body = modelBody("WaiverRankEyeQResultsSnapshot");
    expect(body).toMatch(/contestResults\s+WaiverContestResult\[\]/);
    expect(body).toMatch(/gradeRuns\s+WaiverGradeRun\[\]/);
    expect(body).toMatch(/gradeApprovals\s+WaiverGradeApproval\[\]/);
  });

  it("keeps the D3 conflict resolution SNG-only", () => {
    const body = modelBody("WaiverConflictResolution");
    expect(body).toMatch(/^\s*artifactRowId\s+String\s/m);
    expect(body).not.toMatch(/rankEyeQSnapshotId/);
  });

  it("adds columns, indexes and Restrict foreign keys without touching data", () => {
    for (const table of DUAL_SOURCE_MODELS) {
      expect(SQL).toMatch(new RegExp(`ALTER TABLE "${table}" ADD COLUMN\\s+"rankEyeQSnapshotId" TEXT,\\s+ALTER COLUMN "artifactRowId" DROP NOT NULL`));
    }
    for (const table of ["WaiverContestResult", "WaiverGradeRun", "WaiverGradeApproval"]) {
      expect(SQL).toContain(`CREATE INDEX "${table}_rankEyeQSnapshotId_idx" ON "${table}"("rankEyeQSnapshotId")`);
      expect(SQL).toMatch(
        new RegExp(`ALTER TABLE "${table}" ADD CONSTRAINT "${table}_rankEyeQSnapshotId_fkey" FOREIGN KEY \\("rankEyeQSnapshotId"\\) REFERENCES "WaiverRankEyeQResultsSnapshot"\\("id"\\) ON DELETE RESTRICT`),
      );
    }
    // No backfill or row rewrite: existing rows keep their artifactRowId and satisfy the XOR as-is.
    expect(SQL).not.toMatch(/^\s*(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\b/im);
    expect(SQL).not.toMatch(/DROP (TABLE|COLUMN)/i);
  });

  it.each(DUAL_SOURCE_MODELS)("pins exactly one source on %s with a CHECK", (table) => {
    const re = new RegExp(`ALTER TABLE "${table}" ADD CONSTRAINT "${table}_source_xor_check" CHECK \\(\\s*num_nonnulls\\("artifactRowId", "rankEyeQSnapshotId"\\) = 1`);
    expect(SQL).toMatch(re);
  });

  it("keeps SNG approvals from carrying the RankEyeQ native crosswalk marker", () => {
    expect(SQL).toContain(`("rankEyeQSnapshotId" IS NOT NULL) = ("defCrosswalkVersion" = 'rankeyeq-native/1')`);
  });

  it.each([
    "waiver_contest_result_guard",
    "waiver_pool_result_guard",
    "waiver_grade_run_guard",
    "waiver_grade_approval_guard",
    "waiver_grade_authority_change_guard",
    "waiver_grade_authority_pointer_guard",
    "waiver_week_grade_publication_guard",
  ])("replaces %s (CREATE OR REPLACE keeps its trigger bindings)", (fn) => {
    expect(SQL).toContain(`CREATE OR REPLACE FUNCTION "${fn}"()`);
  });

  it("requires an ACCEPTED, week-matching, checksum-matching RankEyeQ snapshot where an SNG artifact was required", () => {
    expect(SQL).toContain('CREATE FUNCTION "waiver_rankeyeq_results_snapshot_state"');
    expect(SQL).toContain('CREATE FUNCTION "waiver_grading_source_accepted"');
    expect(SQL).toMatch(/s\."weekId" = NEW\."weekId" AND s\."contentChecksum" = NEW\."artifactContentChecksum"/);
    expect(SQL).toContain("a grade run requires an ACCEPTED RankEyeQ results snapshot");
    expect(SQL).toContain("a contest result requires an ACCEPTED RankEyeQ results snapshot");
    expect(SQL).toContain("a grading approval requires an ACCEPTED RankEyeQ results snapshot");
    // The SNG branches keep their ACCEPTED artifact checks.
    expect(SQL).toContain("a contest result requires an ACCEPTED canonical artifact");
    expect(SQL).toContain("a grade run requires an ACCEPTED canonical artifact");
    expect(SQL).toContain("a grading approval requires an ACCEPTED canonical artifact");
  });

  it("compares sources NULL-safely, so a RankEyeQ row never matches an SNG artifact row", () => {
    expect(SQL).toMatch(/r\."artifactRowId" IS NOT DISTINCT FROM NEW\."artifactRowId"/);
    expect(SQL).toMatch(/r\."rankEyeQSnapshotId" IS NOT DISTINCT FROM NEW\."rankEyeQSnapshotId"/);
    expect(SQL).toContain('v_resolution."artifactRowId" IS DISTINCT FROM v_result."artifactRowId"');
    expect(SQL).toContain('v_run."rankEyeQSnapshotId" IS DISTINCT FROM NEW."rankEyeQSnapshotId"');
  });

  it("does not change any scoring version gate (WAIVER_EYEQ_V1 stays pinned by the original migration)", () => {
    expect(SQL).not.toMatch(/gradingRulesetVersion|"scoringVersion" =/);
  });
});
