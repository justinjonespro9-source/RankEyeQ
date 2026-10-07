import { describe, expect, it } from "vitest";
import { buildSyntheticCanonicalArtifact } from "@/lib/waivers/__fixtures__/canonical-artifact";
import { verifySngCanonicalArtifact, type VerifiedSngCanonicalArtifact } from "@/lib/waivers/canonical/artifact-verifier";
import { evaluateWaiverCanonicalPreflight, type PreflightSnapshotEntry } from "@/lib/waivers/canonical/preflight-model";

function verified(): VerifiedSngCanonicalArtifact {
  const result = verifySngCanonicalArtifact(buildSyntheticCanonicalArtifact().bytes);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return { artifact: result.artifact, summary: result.summary };
}

type EntryOverrides = Partial<Omit<PreflightSnapshotEntry, "rankable">> & { rankable?: Partial<PreflightSnapshotEntry["rankable"]> };

function entry(id: string, position: string, externalId: string, team: string, overrides: EntryOverrides = {}): PreflightSnapshotEntry {
  const { rankable, ...rest } = overrides;
  return {
    snapshotEntryId: id,
    rankableEntryId: `re-${id}`,
    position,
    evidenceRole: "CANDIDATE",
    eligibility: "ELIGIBLE",
    displayNameAtFreeze: `Player ${id}`,
    teamAtFreeze: team,
    isByeAtFreeze: false,
    frozenIdentity: null,
    rankable: { provider: "nflcom-bootstrap", externalId, team, active: true, adminNotes: null, name: `Player ${id}`, ...rankable },
    ...rest,
  };
}

const ENTRIES: PreflightSnapshotEntry[] = [
  entry("qb-a", "QB", "nfl-qb-a", "SF"),
  entry("qb-dnp", "QB", "nfl-qb-dnp", "LAR"),
  entry("qb-moved-team", "QB", "nfl-qb-b", "SF"),
  entry("rb-cancel", "RB", "nfl-rb-cancel", "KC"),
  entry("rb-bye", "RB", "nfl-rb-bye", "GB"),
  entry("rb-zero", "RB", "nfl-rb-zero", "WAS"),
  entry("rb-inactive", "RB", "nfl-rb-a", "SF", { rankable: { active: false } }),
  entry("te-merged", "TE", "nfl-te-a", "SF", { rankable: { active: false, adminNotes: "Merged into ck1: duplicate" } }),
  entry("te-as-wr", "TE", "nfl-wr-a", "SF"),
  entry("wr-missing", "WR", "nfl-wr-zz", "SF", { displayNameAtFreeze: "Wren Alpha" }),
  entry("wr-manual", "WR", "manual-wr", "SF", { rankable: { provider: "manual" } }),
  entry("def-was", "DEF", "def-WAS", "WAS"),
  entry("def-unknown", "DEF", "def-XYZ", "XYZ"),
  entry("excluded", "WR", "nfl-wr-b", "SEA", { eligibility: "EXCLUDED" }),
  entry("follow-up", "WR", "nfl-wr-c", "WAS", { evidenceRole: "FOLLOW_UP", eligibility: "OBSERVATION_ONLY" }),
];
const snapshot = (entries = ENTRIES, seasonYear = 2026, weekNumber = 5) => ({ id: "snap-1", status: "FROZEN", seasonYear, weekNumber, entries });
const issueCodes = (report: ReturnType<typeof evaluateWaiverCanonicalPreflight>, id: string) =>
  report.rows.find((row) => row.snapshotEntryId === id)!.issues.map((issue) => issue.code);

describe("evaluateWaiverCanonicalPreflight with a verified artifact", () => {
  const report = evaluateWaiverCanonicalPreflight({ snapshot: snapshot(), verified: verified() });

  it("evaluates only the frozen pool (eligible candidates)", () => {
    expect(report.rows.map((row) => row.snapshotEntryId)).not.toContain("excluded");
    expect(report.rows.map((row) => row.snapshotEntryId)).not.toContain("follow-up");
    expect(report.counts.poolSize).toBe(13);
  });

  it("reports matched rows with canonical state, SNG position and overall rank", () => {
    const qb = report.rows.find((row) => row.snapshotEntryId === "qb-a")!;
    expect(qb).toMatchObject({ matched: true, issues: [], canonical: { participantId: "qb-a", cls: "RANKED", overallPositionRank: 1, pointsHundredths: 2410 } });
    expect(report.rows.find((row) => row.snapshotEntryId === "rb-zero")!.canonical).toMatchObject({ cls: "RANKED", pointsHundredths: 0, overallPositionRank: 4 });
    expect(report.rows.find((row) => row.snapshotEntryId === "qb-dnp")!.canonical).toMatchObject({ cls: "NON_PARTICIPANT", pointsHundredths: null, overallPositionRank: null });
    expect(report.rows.find((row) => row.snapshotEntryId === "rb-cancel")!.canonical).toMatchObject({ cls: "SYSTEMIC_NEUTRALIZE" });
  });

  it("matches Washington DEF through the crosswalk", () => {
    const def = report.rows.find((row) => row.snapshotEntryId === "def-was")!;
    expect(def).toMatchObject({ matched: true, issues: [], consumerKey: { externalId: "washington-commanders" }, canonical: { participantId: "def-was" } });
  });

  it("labels a position mismatch without blocking (decision 5)", () => {
    const row = report.rows.find((r) => r.snapshotEntryId === "te-as-wr")!;
    expect(row).toMatchObject({ positionMismatch: true, issues: [], canonical: { sngPosition: "WR" } });
  });

  it("reports missing, provider, inactive, merged, DEF crosswalk and conflict blockers", () => {
    expect(issueCodes(report, "wr-missing")).toEqual(["PARTICIPANT_NOT_IN_LEDGER"]);
    expect(issueCodes(report, "wr-manual")).toEqual(["IDENTITY_PROVIDER_NOT_CONTRACT"]);
    expect(issueCodes(report, "rb-inactive")).toEqual(["IDENTITY_ENTRY_INACTIVE"]);
    expect(issueCodes(report, "te-merged")).toEqual(["IDENTITY_ENTRY_MERGED"]);
    expect(issueCodes(report, "def-unknown")).toEqual(["DEF_CROSSWALK_MISSING"]);
    expect(issueCodes(report, "rb-bye")).toEqual(["SNAPSHOT_CANONICAL_CONFLICT"]);
    expect(issueCodes(report, "qb-moved-team")).toEqual(["SNAPSHOT_CANONICAL_CONFLICT"]);
    expect(report.rows.find((row) => row.snapshotEntryId === "qb-moved-team")!.conflicts[0].kind).toBe("TEAM_CHANGED");
  });

  it("detects two pool rows resolving to one participant", () => {
    const duplicate = entry("rb-a-dup", "RB", "nfl-rb-a", "SF");
    const dupReport = evaluateWaiverCanonicalPreflight({ snapshot: snapshot([entry("rb-a", "RB", "nfl-rb-a", "SF"), duplicate]), verified: verified() });
    expect(dupReport.counts.duplicate).toBe(2);
    expect(issueCodes(dupReport, "rb-a-dup")).toEqual(["DUPLICATE_POOL_MATCH"]);
  });

  it("summarizes counts and is not ready", () => {
    expect(report.ready).toBe(false);
    expect(report.counts).toMatchObject({
      matched: 6,
      missing: 1,
      inactive: 1,
      merged: 1,
      providerMismatch: 1,
      defCrosswalkMissing: 1,
      conflicts: 2,
      positionMismatch: 1,
    });
    expect(report.advisories.map((a) => a.code)).toEqual(["IDENTITY_KEY_NOT_FROZEN_AT_SNAPSHOT", "TEAM_CROSSWALK_PENDING_PRODUCER_CONFIRMATION"]);
  });

  it("is ready for a clean pool", () => {
    const clean = evaluateWaiverCanonicalPreflight({
      snapshot: snapshot([entry("qb-a", "QB", "nfl-qb-a", "SF"), entry("qb-dnp", "QB", "nfl-qb-dnp", "LAR"), entry("def-was", "DEF", "def-WAS", "WAS")]),
      verified: verified(),
    });
    expect(clean.blockers).toEqual([]);
    expect(clean.ready).toBe(true);
  });

  it("blocks a season/week mismatch", () => {
    const wrongWeek = evaluateWaiverCanonicalPreflight({ snapshot: snapshot([entry("qb-a", "QB", "nfl-qb-a", "SF")], 2026, 6), verified: verified() });
    expect(wrongWeek.blockers.map((b) => b.code)).toEqual(["WEEK_MISMATCH"]);
  });
});

describe("frozen identity (Stage 4B.1)", () => {
  const frozen = (externalId: string, provider = "nflcom-bootstrap") => ({ frozenIdentity: { provider, externalId } });

  it("matches on the frozen identity, not the live one", () => {
    const report = evaluateWaiverCanonicalPreflight({
      snapshot: snapshot([entry("qb-a", "QB", "nfl-qb-a", "SF", frozen("nfl-qb-a"))]),
      verified: verified(),
    });
    const row = report.rows[0];
    expect(row).toMatchObject({ identitySource: "FROZEN_AT_SNAPSHOT", rankeyeqIdentity: { externalId: "nfl-qb-a" }, matched: true, issues: [] });
    expect(report.ready).toBe(true);
    expect(report.advisories.map((a) => a.code)).not.toContain("IDENTITY_KEY_NOT_FROZEN_AT_SNAPSHOT");
    expect(report.counts).toMatchObject({ identityNotFrozen: 0, frozenIdentityMismatch: 0 });
  });

  it("blocks when the live externalId drifted from the frozen one and still grades against the frozen key", () => {
    const report = evaluateWaiverCanonicalPreflight({
      snapshot: snapshot([entry("qb-a", "QB", "nfl-qb-dnp", "SF", frozen("nfl-qb-a"))]),
      verified: verified(),
    });
    const row = report.rows[0];
    expect(row.issues.map((i) => i.code)).toEqual(["FROZEN_IDENTITY_MISMATCH"]);
    expect(row).toMatchObject({ rankeyeqIdentity: { externalId: "nfl-qb-a" }, liveIdentity: { externalId: "nfl-qb-dnp" }, canonical: { participantId: "qb-a" } });
    expect(report.ready).toBe(false);
    expect(report.counts.frozenIdentityMismatch).toBe(1);
  });

  it("blocks when the live provider drifted from the frozen one", () => {
    const report = evaluateWaiverCanonicalPreflight({
      snapshot: snapshot([entry("qb-a", "QB", "nfl-qb-a", "SF", { ...frozen("nfl-qb-a"), rankable: { provider: "manual" } })]),
      verified: null,
    });
    expect(report.rows[0].issues.map((i) => i.code)).toEqual(["FROZEN_IDENTITY_MISMATCH"]);
  });

  it("keeps the advisory and live matching for legacy rows without frozen identity", () => {
    const report = evaluateWaiverCanonicalPreflight({
      snapshot: snapshot([entry("qb-a", "QB", "nfl-qb-a", "SF"), entry("qb-dnp", "QB", "nfl-qb-dnp", "LAR", frozen("nfl-qb-dnp"))]),
      verified: verified(),
    });
    expect(report.rows.map((row) => row.identitySource)).toEqual(["LIVE_NOT_FROZEN", "FROZEN_AT_SNAPSHOT"]);
    expect(report.advisories.find((a) => a.code === "IDENTITY_KEY_NOT_FROZEN_AT_SNAPSHOT")?.detail).toContain("1 of 2 pool rows");
    expect(report.counts.identityNotFrozen).toBe(1);
    expect(report.blockers).toEqual([]);
    expect(report.ready).toBe(true);
  });
});

describe("evaluateWaiverCanonicalPreflight without an artifact", () => {
  it("evaluates identity risks only and is never ready", () => {
    const report = evaluateWaiverCanonicalPreflight({ snapshot: snapshot(), verified: null });
    expect(report.ledgerEvaluated).toBe(false);
    expect(report.ready).toBe(false);
    expect(report.rows.every((row) => row.canonical === null)).toBe(true);
    expect(report.counts).toMatchObject({ missing: 0, inactive: 1, merged: 1, providerMismatch: 1, defCrosswalkMissing: 1, conflicts: 0 });
    expect(report.advisories.map((a) => a.code)).toContain("LEDGER_NOT_EVALUATED");
  });

  it("surfaces artifact verification failures", () => {
    const report = evaluateWaiverCanonicalPreflight({ snapshot: snapshot(), verified: null, artifactIssues: [{ code: "CONTENT_CHECKSUM_MISMATCH", detail: "x" }] });
    expect(report.blockers[0]).toMatchObject({ code: "ARTIFACT_NOT_VERIFIED", detail: "CONTENT_CHECKSUM_MISMATCH" });
  });
});
