import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SQL = readFileSync(path.join(ROOT, "prisma/migrations/20261007120000_waivers_canonical_artifact_authority/migration.sql"), "utf8");
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

const body = (name: string) => SQL.match(new RegExp(`FUNCTION "${name}"\\(\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`))![1];
const block = (kind: "model" | "enum", name: string) => SCHEMA.match(new RegExp(`^${kind} ${name} \\{([\\s\\S]*?)^\\}`, "m"))?.[1] ?? null;

const MODELS = ["WaiverCanonicalArtifact", "WaiverCanonicalArtifactContent", "WaiverCanonicalArtifactEvent"];

describe("Stage 4B.2 canonical artifact authority migration (static)", () => {
  const all = statements(SQL);

  it("is additive: one enum, three tables, indexes, Restrict FKs, CHECKs, guard functions and triggers on new objects only", () => {
    const kinds = [
      [/^CREATE TYPE "WaiverCanonicalPublicationState" AS ENUM \('ACCEPTED', 'SUPERSEDED', 'WITHDRAWN'\)$/, 1],
      [/^CREATE TABLE "WaiverCanonicalArtifact(Content|Event)?" \(/, 3],
      [/^CREATE (UNIQUE )?INDEX "WaiverCanonicalArtifact\w*" ON "WaiverCanonicalArtifact(Content|Event)?"\(/, 7],
      [/^ALTER TABLE "WaiverCanonicalArtifact(Content|Event)?" ADD CONSTRAINT "\w+_fkey" FOREIGN KEY \("\w+"\) REFERENCES "\w+"\("(id|artifactId)"\) ON DELETE RESTRICT ON UPDATE CASCADE$/, 7],
      [/^ALTER TABLE "WaiverCanonicalArtifact(Content|Event)?" ADD CONSTRAINT "WaiverCanonicalArtifact\w*_check" CHECK \(/, 6],
      [/^CREATE FUNCTION "waiver_canonical_artifact_\w+"\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$BODY\$\$$/, 5],
      [/^CREATE TRIGGER "WaiverCanonicalArtifact(Content|Event)?_guard" BEFORE INSERT OR UPDATE OR DELETE ON "WaiverCanonicalArtifact(Content|Event)?" FOR EACH ROW EXECUTE FUNCTION/, 3],
      [
        /^CREATE TRIGGER "WaiverCanonicalArtifact(Content|Event)?_no_truncate" BEFORE TRUNCATE ON "WaiverCanonicalArtifact(Content|Event)?" FOR EACH STATEMENT EXECUTE FUNCTION "waiver_canonical_artifact_truncate_guard"\(\)$/,
        3,
      ],
      [/^CREATE CONSTRAINT TRIGGER "WaiverCanonicalArtifact_complete" AFTER INSERT ON "WaiverCanonicalArtifact" DEFERRABLE INITIALLY DEFERRED/, 1],
    ] as const;
    for (const [re, count] of kinds) expect(all.filter((s) => re.test(s)).length, String(re)).toBe(count);
    expect(all.length).toBe(kinds.reduce((sum, [, count]) => sum + count, 0));
  });

  it("never drops, rewrites, backfills, or alters existing tables", () => {
    expect(SQL).not.toMatch(/\b(DROP|DELETE\s+FROM|INSERT\s+INTO|RENAME|ALTER\s+COLUMN|ALTER\s+TYPE|CREATE\s+OR\s+REPLACE)\b/i);
    expect(SQL).not.toMatch(/^\s*TRUNCATE\b/im);
    expect(SQL).not.toMatch(/^\s*UPDATE\s+"/im);
    expect(SQL).not.toMatch(/ON DELETE (CASCADE|SET NULL|SET DEFAULT|NO ACTION)/i);
    for (const statement of all.filter((s) => s.startsWith("ALTER TABLE"))) expect(statement).toMatch(/^ALTER TABLE "WaiverCanonicalArtifact(Content|Event)?" /);
  });

  it("guards reject UPDATE, allow DELETE only under fixture maintenance, and stamp the database clock", () => {
    for (const name of ["waiver_canonical_artifact_guard", "waiver_canonical_artifact_content_guard", "waiver_canonical_artifact_event_guard"]) {
      const fn = body(name);
      expect(fn).toMatch(/IF TG_OP = 'UPDATE' THEN\s+RAISE EXCEPTION 'WAIVER_IMMUTABLE:/);
      expect(fn).toMatch(/IF TG_OP = 'DELETE' THEN\s+IF "waiver_fixture_maintenance"\(\) THEN\s+RETURN OLD;\s+END IF;\s+RAISE EXCEPTION 'WAIVER_IMMUTABLE:/);
    }
    expect(body("waiver_canonical_artifact_guard")).toMatch(/NEW\."importedAt" := "waiver_utc_now"\(\)/);
    expect(body("waiver_canonical_artifact_event_guard")).toMatch(/NEW\."recordedAt" := "waiver_utc_now"\(\)/);
  });

  it("TRUNCATE is refused on every artifact table outside fixture maintenance", () => {
    expect(body("waiver_canonical_artifact_truncate_guard")).toMatch(
      /IF "waiver_fixture_maintenance"\(\) THEN\s+RETURN NULL;\s+END IF;\s+RAISE EXCEPTION 'WAIVER_IMMUTABLE: canonical artifact records cannot be truncated';/,
    );
  });

  it("the event guard enforces sequence, WITHDRAWN as terminal, SUPERSEDED -> WITHDRAWN only, and verified successors", () => {
    const fn = body("waiver_canonical_artifact_event_guard");
    expect(fn).toContain(`NEW."sequence" <> v_last."sequence" + 1`);
    expect(fn).toMatch(/IF v_last\."state" = 'WITHDRAWN' THEN\s+RAISE EXCEPTION 'WAIVER_INVALID: WITHDRAWN is terminal/);
    expect(fn).toMatch(/IF NEW\."state" = 'ACCEPTED' THEN\s+RAISE EXCEPTION 'WAIVER_INVALID: an artifact is ACCEPTED only by its import'/);
    expect(fn).toMatch(/IF v_last\."state" = 'SUPERSEDED' AND NEW\."state" <> 'WITHDRAWN' THEN\s+RAISE EXCEPTION 'WAIVER_INVALID:/);
    expect(fn).toContain(`s."supersedesArtifactId" = v_artifact."artifactId"`);
    expect(SQL).toContain(`"textSha256" = encode(sha256(convert_to("contentText", 'UTF8')), 'hex')`);
    expect(SQL).toContain(`"expectedContentChecksum" = "contentChecksum" AND "attestedPublicationState" = 'ACCEPTED'`);
  });
});

describe("Stage 4B.2 Prisma models (static)", () => {
  it("declares the three models, the publication-state enum and the uniqueness rules", () => {
    expect(block("enum", "WaiverCanonicalPublicationState")?.replace(/\s+/g, " ").trim()).toContain("ACCEPTED SUPERSEDED WITHDRAWN");
    const artifact = block("model", "WaiverCanonicalArtifact")!;
    expect(artifact).toMatch(/artifactId\s+String\s+@unique/);
    expect(artifact).toMatch(/contentChecksum\s+String\s+@unique/);
    expect(artifact).toMatch(/supersedesArtifactId\s+String\?\s+@unique/);
    expect(artifact).toMatch(/@@unique\(\[seriesKey, revision\]\)/);
    expect(artifact).not.toMatch(/contentText/);
    expect(block("model", "WaiverCanonicalArtifactContent")).toMatch(/artifactRowId\s+String\s+@id/);
    expect(block("model", "WaiverCanonicalArtifactEvent")).toMatch(/@@unique\(\[artifactRowId, sequence\]\)/);
  });

  it("every relation is onDelete: Restrict", () => {
    for (const name of MODELS) {
      const lines = block("model", name)!.split("\n").filter((line) => /@relation\([^)]*fields:/.test(line));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(line).toMatch(/onDelete:\s*Restrict/);
    }
  });

  it("the Stage 4B.2 migration adds no grading, result or leaderboard table (those arrive separately in 4B.3)", () => {
    for (const name of ["WaiverContestResult", "WaiverPoolResult", "WaiverBoardGrade", "WaiverCallGrade", "WaiverGradeRun"]) {
      expect(SQL).not.toContain(`"${name}"`);
    }
  });
});
