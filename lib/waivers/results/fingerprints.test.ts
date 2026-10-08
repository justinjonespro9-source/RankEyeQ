import { describe, expect, it } from "vitest";
import { canonicalExportChecksum } from "@/lib/waivers/canonical/serialization";
import { WAIVER_POSITIONS } from "@/lib/waivers/constants";
import * as fp from "@/lib/waivers/results/fingerprints";

/** Stage 4B.3 test 23 (pure half): deterministic, order-independent fingerprints. */

const h = (s: string) => s.padEnd(64, "0");
const reversed = <T>(items: readonly T[]) => [...items].reverse();

const positioned: fp.PositionedResult[] = WAIVER_POSITIONS.map((position, i) => ({
  position,
  kind: "CONTEST_RESULT" as const,
  inputFingerprint: h(`in${i}`),
  resultFingerprint: h(`res${i}`),
}));
const boards = [
  { submissionId: "sub-b", inputFingerprint: h("ib"), outputFingerprint: h("ob") },
  { submissionId: "sub-a", inputFingerprint: h("ia"), outputFingerprint: h("oa") },
  { submissionId: "sub-c", inputFingerprint: h("ic"), outputFingerprint: h("oc") },
];
const runInput = {
  gradingRulesetVersion: "rankeyeq-waiver-grading/1",
  scoringVersion: "WAIVER_EYEQ_V1",
  season: 2025,
  weekNumber: 5,
  artifactFingerprint: h("art"),
  snapshotSetFingerprint: h("snap"),
  resolutionSetFingerprint: h("res"),
  contestResults: positioned,
  boards,
};

describe("grading fingerprints", () => {
  it("follow the documented envelope: canonicalExportChecksum of { v, kind, ...payload }", () => {
    const artifact = { seriesKey: "series", revision: 2, artifactId: "a-2", contentChecksum: h("c") };
    expect(fp.artifactIdentityFingerprint(artifact)).toBe(canonicalExportChecksum({ v: fp.WAIVER_GRADING_FINGERPRINT_VERSION, kind: "artifact-identity", ...artifact }));
    expect(fp.WAIVER_GRADING_FINGERPRINT_VERSION).toBe("rankeyeq-waiver-grading-fp/1");
    expect(fp.artifactIdentityFingerprint(artifact)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("separate kinds never collide on the same payload", () => {
    const pins = WAIVER_POSITIONS.map((position) => ({ position, snapshotFingerprint: h("s") }));
    expect(fp.snapshotSetFingerprint(pins)).not.toBe(fp.artifactIdentityFingerprint({ seriesKey: "s", revision: 1, artifactId: "a", contentChecksum: h("c") }));
  });

  it("are invariant to collection order (boards, results, resolutions, participants, pool rows, called players)", () => {
    expect(fp.gradeRunInputFingerprint({ ...runInput, contestResults: reversed(positioned), boards: reversed(boards) })).toBe(fp.gradeRunInputFingerprint(runInput));
    const output = { gradeRunInputFingerprint: h("run"), contestResults: positioned, boards };
    expect(fp.weekGradeOutputFingerprint({ ...output, contestResults: reversed(positioned), boards: reversed(boards) })).toBe(fp.weekGradeOutputFingerprint(output));

    const resolutions = [
      { conflictKey: h("k2"), sequence: 1, conflictKind: "BYE_VS_SCHEDULED" as const, resolution: "NEUTRALIZED" as const },
      { conflictKey: h("k1"), sequence: 2, conflictKind: "TEAM_CHANGED" as const, resolution: "SCORE_AS_RANKED" as const },
    ];
    expect(fp.resolutionSetFingerprint(reversed(resolutions))).toBe(fp.resolutionSetFingerprint(resolutions));

    const participants = [
      { participantId: "p2", participationState: "PARTICIPATED_WITH_STATS", participantDisposition: "PLAYED", pointsHundredths: 1200, competitionRank: 1, resultFingerprint: h("r2") },
      { participantId: "p1", participationState: "VERIFIED_NON_PARTICIPANT", participantDisposition: "DNP", pointsHundredths: null, competitionRank: null, resultFingerprint: null },
    ];
    const source = { artifactFingerprint: h("a"), position: "QB" as const, sngResultSetChecksum: h("set"), participants };
    expect(fp.contestSourceFingerprint({ ...source, participants: reversed(participants) })).toBe(fp.contestSourceFingerprint(source));

    const rows = [
      { category: "INVALIDATED_CALLED_PLAYER", rankableEntryId: "re-1", rowFingerprint: h("x") },
      { category: "ELIGIBLE_POOL_MEMBER", rankableEntryId: "re-3", rowFingerprint: h("y") },
      { category: "ELIGIBLE_POOL_MEMBER", rankableEntryId: "re-2", rowFingerprint: h("z") },
    ];
    const result = { position: "QB" as const, resultFieldSize: 3, eligiblePoolSize: 2, effectivePoolSize: 2, effectiveFieldSize: 2, effectiveAvailableSlots: 2, invalidatedCalledCount: 1, rows };
    expect(fp.contestResultFingerprint({ ...result, rows: reversed(rows) })).toBe(fp.contestResultFingerprint(result));

    const input = { resultsPolicyVersion: "rankeyeq-waiver-results/1", position: "QB" as const, artifactFingerprint: h("a"), snapshotFingerprint: h("s"), sourceFingerprint: h("src"), resolutionSetFingerprint: h("r"), calledRankableEntryIds: ["re-2", "re-1", "re-2"] };
    expect(fp.contestResultInputFingerprint({ ...input, calledRankableEntryIds: ["re-1", "re-2"] })).toBe(fp.contestResultInputFingerprint(input));

    const calls = [
      { slot: 2, inputFingerprint: h("c2"), outputFingerprint: h("o2") },
      { slot: 1, inputFingerprint: h("c1"), outputFingerprint: h("o1") },
    ];
    const boardInput = { submissionId: "s", revisionId: "r", revisionFingerprint: h("rev"), position: "QB" as const, contestResultFingerprint: h("cr"), availableSlots: 3, calls };
    expect(fp.boardGradeInputFingerprint({ ...boardInput, calls: reversed(calls) })).toBe(fp.boardGradeInputFingerprint(boardInput));
  });

  it("change whenever any bound input changes", () => {
    const base = fp.gradeRunInputFingerprint(runInput);
    expect(fp.gradeRunInputFingerprint({ ...runInput, artifactFingerprint: h("art2") })).not.toBe(base);
    expect(fp.gradeRunInputFingerprint({ ...runInput, resolutionSetFingerprint: h("res2") })).not.toBe(base);
    expect(fp.gradeRunInputFingerprint({ ...runInput, scoringVersion: "WAIVER_EYEQ_V2" })).not.toBe(base);
    expect(fp.gradeRunInputFingerprint({ ...runInput, boards: boards.slice(1) })).not.toBe(base);
    expect(fp.gradeRunInputFingerprint({ ...runInput, boards: boards.map((b, i) => (i ? b : { ...b, inputFingerprint: h("changed") })) })).not.toBe(base);
  });

  it("week-level fingerprints require each of the five positions exactly once", () => {
    expect(() => fp.gradeRunInputFingerprint({ ...runInput, contestResults: positioned.slice(1) })).toThrow(RangeError);
    expect(() => fp.gradeRunInputFingerprint({ ...runInput, contestResults: [...positioned.slice(1), { ...positioned[1] }] })).toThrow(RangeError);
    expect(() => fp.snapshotSetFingerprint(WAIVER_POSITIONS.slice(0, 4).map((position) => ({ position, snapshotFingerprint: h("s") })))).toThrow(RangeError);
  });

  it("an explicit empty position is part of the week identity and never mistaken for a contest result", () => {
    const emptyTe = fp.emptyPositionResultFingerprint({ resultsPolicyVersion: "rankeyeq-waiver-results/1", position: "TE", snapshotFingerprint: h("s") });
    expect(emptyTe).toBe(fp.emptyPositionResultFingerprint({ resultsPolicyVersion: "rankeyeq-waiver-results/1", position: "TE", snapshotFingerprint: h("s") }));
    expect(emptyTe).not.toBe(fp.emptyPositionResultFingerprint({ resultsPolicyVersion: "rankeyeq-waiver-results/1", position: "TE", snapshotFingerprint: h("s2") }));
    const withEmpty = positioned.map((r) => (r.position === "TE" ? { position: r.position, kind: "EMPTY_ELIGIBLE_POOL" as const, inputFingerprint: null, resultFingerprint: emptyTe } : r));
    const asContest = positioned.map((r) => (r.position === "TE" ? { ...r, resultFingerprint: emptyTe } : r));
    expect(fp.gradeRunInputFingerprint({ ...runInput, contestResults: withEmpty })).not.toBe(fp.gradeRunInputFingerprint({ ...runInput, contestResults: asContest }));
    const output = { gradeRunInputFingerprint: h("run"), boards };
    expect(fp.weekGradeOutputFingerprint({ ...output, contestResults: withEmpty })).not.toBe(fp.weekGradeOutputFingerprint({ ...output, contestResults: asContest }));
    expect(fp.gradeRunInputFingerprint({ ...runInput, contestResults: reversed(withEmpty) })).toBe(fp.gradeRunInputFingerprint({ ...runInput, contestResults: withEmpty }));

    const allEmpty = WAIVER_POSITIONS.map((position) => ({ position, kind: "EMPTY_ELIGIBLE_POOL" as const, inputFingerprint: null, resultFingerprint: h("e") }));
    expect(() => fp.gradeRunInputFingerprint({ ...runInput, contestResults: allEmpty })).toThrow(/at least one contest result/);
    const emptyWithInput = withEmpty.map((r) => (r.kind === "EMPTY_ELIGIBLE_POOL" ? ({ ...r, inputFingerprint: h("x") } as unknown as fp.PositionedResult) : r));
    expect(() => fp.gradeRunInputFingerprint({ ...runInput, contestResults: emptyWithInput })).toThrow(RangeError);
  });

  it("a resolution set holds one current resolution per conflict, and board slots must be contiguous", () => {
    const r = { conflictKey: h("k"), sequence: 1, conflictKind: "BYE_VS_SCHEDULED" as const, resolution: "NEUTRALIZED" as const };
    expect(() => fp.resolutionSetFingerprint([r, { ...r, sequence: 2 }])).toThrow(RangeError);
    expect(fp.resolutionSetFingerprint([])).toMatch(/^[0-9a-f]{64}$/);
    expect(() => fp.boardGradeOutputFingerprint({} as fp.BoardGradeOutput, [{ slot: 1, outputFingerprint: h("a") }, { slot: 3, outputFingerprint: h("b") }])).toThrow(RangeError);
  });

  it("pool rows reference a resolution by conflict key and sequence, never by row id", () => {
    const row: fp.PoolRowFingerprintInput = {
      category: "ELIGIBLE_POOL_MEMBER",
      snapshotEntryId: "entry-1",
      rankableEntryId: "re-1",
      position: "WR",
      identityProvider: "sleeper",
      identityExternalId: "123",
      sngParticipantId: "sng-1",
      participationState: "VERIFIED_NON_PARTICIPANT",
      participantDisposition: "BYE",
      canonicalClass: "SNAPSHOT_CONFLICT",
      canonicalPointsHundredths: null,
      canonicalPositionRank: null,
      sngResultFingerprint: null,
      treatment: "NEUTRALIZED",
      fpHundredths: null,
      waiverPoolRank: null,
      neutralizationPrecedence: null,
      resolution: { conflictKey: h("k"), sequence: 1 },
      invalidationBasis: null,
    };
    expect(fp.poolRowFingerprint({ ...row, resolution: { conflictKey: h("k"), sequence: 2 } })).not.toBe(fp.poolRowFingerprint(row));
    expect(fp.poolRowFingerprint({ ...row })).toBe(fp.poolRowFingerprint(row));
  });
});
