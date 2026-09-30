import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCHEMA = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
const MIGRATIONS_DIR = path.join(ROOT, "prisma/migrations");
const WAIVERS_MIGRATION = "20260930000000_waivers_snapshot_evidence";
const MIGRATION_SQL = readFileSync(path.join(MIGRATIONS_DIR, WAIVERS_MIGRATION, "migration.sql"), "utf8");

type Block = { kind: "model" | "enum"; name: string; body: string };

function blocks(schema: string): Block[] {
  const out: Block[] = [];
  const re = /^(model|enum)\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  for (const m of schema.matchAll(re)) out.push({ kind: m[1] as Block["kind"], name: m[2], body: m[3] });
  return out;
}

const ALL = blocks(SCHEMA);
const PHASE1_MODEL_NAMES = ["WaiverSnapshot", "WaiverSnapshotCorrection", "WaiverSnapshotEntry"];
const PHASE1_ENUM_NAMES = [
  "WaiverCorrectionCase",
  "WaiverCorrectionPolicy",
  "WaiverEligibility",
  "WaiverEvidenceRole",
  "WaiverExclusionReason",
  "WaiverMatchMethod",
  "WaiverSnapshotStatus",
];
/** Phase 2 competition objects are covered by competition-schema.test.ts. */
const PHASE2_MODEL_NAMES = ["WaiverCall", "WaiverContest", "WaiverSubmission", "WaiverSubmissionRevision"];
const PHASE2_ENUM_NAMES = ["WaiverContestStatus", "WaiverRevisionKind", "WaiverSubmissionStatus"];
const PHASE2_MIGRATION = "20261001000000_waivers_competition_foundation";
const WAIVER_MODELS = ALL.filter((b) => b.kind === "model" && PHASE1_MODEL_NAMES.includes(b.name));
const ALL_WAIVER_MODELS = ALL.filter((b) => b.kind === "model" && b.name.startsWith("Waiver"));
const WAIVER_ENUMS = ALL.filter((b) => b.kind === "enum" && b.name.startsWith("Waiver"));

function sqlStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

describe("Waivers schema foundation (static)", () => {
  it("Phase 1 adds exactly three Waiver models and seven Waiver enums (Phase 2 adds only its own)", () => {
    expect(WAIVER_MODELS.map((b) => b.name).sort()).toEqual([...PHASE1_MODEL_NAMES].sort());
    expect(ALL_WAIVER_MODELS.map((b) => b.name).sort()).toEqual([...PHASE1_MODEL_NAMES, ...PHASE2_MODEL_NAMES].sort());
    expect(WAIVER_ENUMS.map((b) => b.name).sort()).toEqual([...PHASE1_ENUM_NAMES, ...PHASE2_ENUM_NAMES].sort());
  });

  it("every Waiver foreign key is onDelete: Restrict (frozen evidence is delete-protected)", () => {
    const relationLines = WAIVER_MODELS.flatMap((b) =>
      b.body.split("\n").filter((l) => /@relation\([^)]*fields:/.test(l)).map((l) => `${b.name}: ${l.trim()}`),
    );
    expect(relationLines.length).toBe(11);
    for (const line of relationLines) expect(line).toMatch(/onDelete:\s*Restrict/);
    for (const b of WAIVER_MODELS) expect(b.body).not.toMatch(/onDelete:\s*(Cascade|SetNull|SetDefault|NoAction)/);
  });

  it("declares the required uniqueness constraints", () => {
    const snapshot = WAIVER_MODELS.find((b) => b.name === "WaiverSnapshot")!.body;
    const entry = WAIVER_MODELS.find((b) => b.name === "WaiverSnapshotEntry")!.body;
    expect(snapshot).toMatch(/@@unique\(\[weekId, version\]\)/);
    expect(snapshot).toMatch(/currentForWeekId\s+String\?\s+@unique/);
    expect(snapshot).toMatch(/supersedesId\s+String\?\s+@unique/);
    expect(entry).toMatch(/@@unique\(\[snapshotId, rankableEntryId\]\)/);
  });

  it("stores ownership in integer basis points and no float columns", () => {
    const entry = WAIVER_MODELS.find((b) => b.name === "WaiverSnapshotEntry")!.body;
    expect(entry).toMatch(/rosteredBps\s+Int\b/);
    for (const b of WAIVER_MODELS) expect(b.body).not.toMatch(/\s(Float|Decimal)\b/);
  });

  it("existing models receive Waiver back-relation list fields only", () => {
    const touched: string[] = [];
    for (const b of ALL) {
      if (b.name.startsWith("Waiver")) continue;
      for (const line of b.body.split("\n")) {
        if (!/Waiver/.test(line)) continue;
        touched.push(b.name);
        expect(line).toMatch(/^\s*\w+\s+Waiver\w+\[\](\s+@relation\("\w+"\))?\s*$/);
      }
    }
    expect([...new Set(touched)].sort()).toEqual(["NflGame", "RankableEntry", "Season", "UniversalProfile", "User", "Week"]);
  });
});

describe("Waivers migration is additive only", () => {
  const statements = sqlStatements(MIGRATION_SQL);

  it("only the Phase 1 and Phase 2 Waivers migrations mention Waiver objects", () => {
    const mentioning = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .filter((d) => /Waiver/.test(readFileSync(path.join(MIGRATIONS_DIR, d.name, "migration.sql"), "utf8")))
      .map((d) => d.name);
    expect(mentioning).toEqual([WAIVERS_MIGRATION, PHASE2_MIGRATION]);
  });

  it("contains only CREATE TYPE/TABLE/INDEX and ADD CONSTRAINT on Waiver objects", () => {
    const allowed = [
      /^CREATE TYPE "Waiver\w+" AS ENUM \(/,
      /^CREATE TABLE "Waiver\w+" \(/,
      /^CREATE (UNIQUE )?INDEX "Waiver\w+" ON "Waiver\w+"\(/,
      /^ALTER TABLE "Waiver\w+" ADD CONSTRAINT "Waiver\w+" FOREIGN KEY \("\w+"\) REFERENCES "\w+"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE$/,
    ];
    const rejected = statements.filter((s) => !allowed.some((re) => re.test(s)));
    expect(rejected).toEqual([]);
    expect(statements.filter((s) => s.startsWith("CREATE TYPE")).length).toBe(7);
    expect(statements.filter((s) => s.startsWith("CREATE TABLE")).length).toBe(3);
    expect(statements.filter((s) => / FOREIGN KEY /.test(s)).length).toBe(11);
  });

  it("never drops, rewrites, renames, or writes data", () => {
    expect(MIGRATION_SQL).not.toMatch(/\b(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+"|INSERT|RENAME|ALTER\s+COLUMN|ALTER\s+TYPE)\b/i);
    expect(MIGRATION_SQL).not.toMatch(/ON DELETE (CASCADE|SET NULL|SET DEFAULT|NO ACTION)/i);
  });
});
