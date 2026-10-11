import { describe, expect, it } from "vitest";
import {
  buildSyntheticCanonicalArtifact,
  SYNTHETIC_PARTICIPANTS,
  syntheticPlayerExternalId,
  type SyntheticParticipantSpec,
} from "@/lib/waivers/__fixtures__/canonical-artifact";
import { verifySngCanonicalArtifact, type VerifiedSngCanonicalArtifact } from "@/lib/waivers/canonical/artifact-verifier";
import { detectSnapshotCanonicalConflicts } from "@/lib/waivers/canonical/policy";
import type { PreflightSnapshotEntry } from "@/lib/waivers/canonical/preflight-model";
import { rankEyeQTeamForSngTeamKey } from "@/lib/waivers/canonical/team-crosswalk";
import { WAIVER_MAX_CALLS, WAIVER_POSITIONS, WAIVER_RESULT_FIELD_SIZE, type WaiverPosition } from "@/lib/waivers/constants";
import { gradeWaiverBoard, type WaiverGradingBoardInput, type WaiverGradingContestRef } from "@/lib/waivers/grading/board-grade";
import {
  buildWaiverContestResult,
  type WaiverContestResultBuild,
  type WaiverContestResultInput,
  type WaiverGradingResolutionInput,
} from "@/lib/waivers/grading/contest-result";
import type { WaiverCompetitor, WaiverGradingIssueCode } from "@/lib/waivers/grading/model";
import { assembleWaiverWeekGrading, type WaiverWeekPositionInput } from "@/lib/waivers/grading/week";

/**
 * Golden fixtures for the Stage 4B.4 grading engine over the synthetic SNG
 * week (ties 1/2/2/4, a participated zero, negatives, DNP, cancelled, moved,
 * BYE, released). Expected values are worked by hand from WAIVER_EYEQ_V1:
 * slot maxima are 33/28/23 (N = 3) and 35/30/25/15/15 (N = 5).
 */

type Ready = Extract<WaiverContestResultBuild, { status: "READY" }>;

function verify(sealed: { bytes: string }): VerifiedSngCanonicalArtifact {
  const checked = verifySngCanonicalArtifact(sealed.bytes, { expectedSeason: 2026, expectedWeek: 5 });
  if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
  return { artifact: checked.artifact, summary: checked.summary };
}

const VERIFIED = verify(buildSyntheticCanonicalArtifact());
const DISTINCT_WR: SyntheticParticipantSpec[] = SYNTHETIC_PARTICIPANTS.map((spec) =>
  spec.id === "wr-b" ? { ...spec, points: 1600 } : spec.id === "wr-d" ? { ...spec, points: 1400 } : spec,
);
const VERIFIED_DISTINCT_WR = verify(buildSyntheticCanonicalArtifact({ participants: DISTINCT_WR }));
const SPECS = new Map(SYNTHETIC_PARTICIPANTS.map((spec) => [spec.id, spec]));

type EntryOptions = {
  eligibility?: string;
  teamAtFreeze?: string;
  isByeAtFreeze?: boolean;
  provider?: string;
  externalId?: string;
  snapshotEntryId?: string;
  rankableEntryId?: string;
  active?: boolean;
};

/** A frozen snapshot entry carrying the contract identity of a synthetic participant. */
function entry(id: string, options: EntryOptions = {}): PreflightSnapshotEntry {
  const spec = SPECS.get(id) ?? { id, position: id.split("-")[0].toUpperCase() as SyntheticParticipantSpec["position"], teamKey: "san-francisco-49ers" };
  const team = rankEyeQTeamForSngTeamKey(spec.teamKey)!.rankeyeqTeam;
  const provider = options.provider ?? "nflcom-bootstrap";
  const externalId = options.externalId ?? (spec.position === "DEF" ? `def-${team}` : syntheticPlayerExternalId(id));
  return {
    snapshotEntryId: options.snapshotEntryId ?? `se-${id}`,
    rankableEntryId: options.rankableEntryId ?? `re-${id}`,
    position: spec.position,
    evidenceRole: "CANDIDATE",
    eligibility: options.eligibility ?? "ELIGIBLE",
    displayNameAtFreeze: spec.name ?? id,
    teamAtFreeze: options.teamAtFreeze ?? team,
    isByeAtFreeze: options.isByeAtFreeze ?? false,
    frozenIdentity: { provider, externalId },
    rankable: { provider, externalId, team, active: options.active ?? true, adminNotes: null, name: spec.name ?? id },
  };
}

const entries = (...ids: string[]) => ids.map((id) => entry(id));

function contestInput(
  position: WaiverPosition,
  pool: PreflightSnapshotEntry[],
  options: { called?: PreflightSnapshotEntry[]; resolutions?: WaiverGradingResolutionInput[]; verified?: VerifiedSngCanonicalArtifact; contentChecksum?: string } = {},
): WaiverContestResultInput {
  const verified = options.verified ?? VERIFIED;
  return {
    position,
    contest: { id: `contest-${position}`, weekId: "week-5", snapshotId: "snapshot-2", maxCalls: WAIVER_MAX_CALLS[position], resultFieldSize: WAIVER_RESULT_FIELD_SIZE[position] },
    snapshot: { season: 2026, weekNumber: 5, version: 2, entriesFingerprint: "entries-fp-2", entries: pool },
    artifact: {
      rowId: "artifact-row-1",
      artifactId: verified.summary.artifactId,
      seriesKey: verified.summary.seriesKey,
      revision: verified.summary.revision,
      contentChecksum: options.contentChecksum ?? verified.summary.contentChecksum,
    },
    verified,
    calledEntries: options.called ?? [],
    resolutions: options.resolutions ?? [],
  };
}

function ready(input: WaiverContestResultInput): Ready {
  const build = buildWaiverContestResult(input);
  if (build.status !== "READY") throw new Error(JSON.stringify(build.issues));
  return build;
}

function blockedCodes(input: WaiverContestResultInput): WaiverGradingIssueCode[] {
  const build = buildWaiverContestResult(input);
  expect(build.status).toBe("BLOCKED");
  return build.status === "BLOCKED" ? [...new Set(build.issues.map((i) => i.code))].sort() : [];
}

const contestRef = (build: Ready): WaiverGradingContestRef => ({
  position: build.result.position,
  contestId: build.result.contestId,
  resultFieldSize: build.result.resultFieldSize,
  effectiveAvailableSlots: build.result.effectiveAvailableSlots,
  resultFingerprint: build.result.resultFingerprint,
  honorScoreableSlots: build.honorScoreableSlots,
  rows: build.rows,
});

const HUMAN: WaiverCompetitor = { universalProfileId: "profile-human", profileType: "HUMAN", competitorActive: true, authority: "OWNER_AUTHORED", entryBasis: "STANDARD" };
const AI_OVERRIDE: WaiverCompetitor = {
  universalProfileId: "profile-ai",
  profileType: "AI",
  competitorActive: true,
  authority: "SYSTEM_OPERATED",
  entryBasis: "ADMIN_COMPETITIVE_OVERRIDE",
};

function board(ids: string[], options: { submissionId?: string; competitor?: WaiverCompetitor } = {}): WaiverGradingBoardInput {
  const submissionId = options.submissionId ?? `sub-${ids.join("+") || "empty"}`;
  return {
    submissionId,
    revisionId: `rev-${submissionId}`,
    revisionFingerprint: `rev-fp-${submissionId}`,
    revisionKind: "SUBMISSION",
    revisionCallCount: ids.length,
    competitor: options.competitor ?? HUMAN,
    calls: ids.map((id, i) => ({ callId: `${submissionId}-call-${i + 1}`, slot: i + 1, snapshotEntryId: `se-${id}`, rankableEntryId: `re-${id}` })),
  };
}

function grade(build: Ready, ids: string[], options: Parameters<typeof board>[1] = {}) {
  const graded = gradeWaiverBoard(contestRef(build), board(ids, options));
  if (graded.status !== "GRADED") throw new Error(JSON.stringify(graded.issues));
  return graded.grade;
}

const summary = (g: ReturnType<typeof grade>) => ({
  resultKind: g.board.resultKind,
  earned: g.board.earnedRawPoints,
  max: g.board.maxRawPoints,
  eyeq: g.board.eyeqHundredths,
  honor: g.board.awardedHonor,
  fpPerCall: g.board.fpPerCallHundredths,
  fpPerSlot: g.board.fpPerAvailableSlotHundredths,
  outcomes: g.calls.map((c) => c.outcome),
});

const RB_POOL = () => entries("rb-a", "rb-tie1", "rb-tie2", "rb-zero", "rb-dnp", "rb-cancel", "rb-moved", "rb-unrostered");

function firstConflict(id: string, teamAtFreeze: string) {
  const ledger = VERIFIED.artifact.payload.participationLedger.find((row) => row.participantId === id)!;
  return detectSnapshotCanonicalConflicts({
    artifactContentChecksum: VERIFIED.summary.contentChecksum,
    snapshotEntryId: `se-${id}`,
    snapshot: { isByeAtFreeze: false, teamAtFreeze },
    canonical: { participantId: id, cls: ledger.disposition === "BYE" ? "SNAPSHOT_CONFLICT" : "RANKED", disposition: ledger.disposition, teamKey: ledger.teamKey },
  })[0];
}

function resolution(id: string, teamAtFreeze: string, treatment: WaiverGradingResolutionInput["resolution"], sequence = 1): WaiverGradingResolutionInput {
  const conflict = firstConflict(id, teamAtFreeze);
  return {
    id: `resolution-${id}-${sequence}`,
    conflictKey: conflict.conflictKey,
    sequence,
    conflictKind: conflict.kind,
    resolution: treatment,
    snapshotEntryId: `se-${id}`,
    sngParticipantId: id,
  };
}

/** An explicit D3 decision on the rb-bye canonical BYE, bound to one frozen entry. */
function byeResolution(snapshotEntryId: string, treatment: WaiverGradingResolutionInput["resolution"]): WaiverGradingResolutionInput {
  const ledger = VERIFIED.artifact.payload.participationLedger.find((row) => row.participantId === "rb-bye")!;
  const [conflict] = detectSnapshotCanonicalConflicts({
    artifactContentChecksum: VERIFIED.summary.contentChecksum,
    snapshotEntryId,
    snapshot: { isByeAtFreeze: false, teamAtFreeze: "GB" },
    canonical: { participantId: "rb-bye", cls: "SNAPSHOT_CONFLICT", disposition: ledger.disposition, teamKey: ledger.teamKey },
  });
  return { id: `resolution-${snapshotEntryId}`, conflictKey: conflict.conflictKey, sequence: 1, conflictKind: conflict.kind, resolution: treatment, snapshotEntryId, sngParticipantId: "rb-bye" };
}

describe("contest result: canonical inputs to the waiver pool", () => {
  it("ranks the post-treatment pool by points with competition ties, keeping DNP, zero and neutralized rows apart", () => {
    const rb = ready(contestInput("RB", RB_POOL()));
    const byId = new Map(rb.rows.map((row) => [row.rankableEntryId.slice(3), row]));
    expect(Object.fromEntries([...byId].map(([id, row]) => [id, [row.treatment, row.waiverPoolRank, row.fpHundredths]]))).toEqual({
      "rb-a": ["RANKED", 1, 2810],
      "rb-tie1": ["RANKED", 2, 1940],
      "rb-tie2": ["RANKED", 2, 1940],
      "rb-zero": ["RANKED", 4, 0],
      "rb-dnp": ["NON_PARTICIPANT_ZERO", null, 0],
      "rb-unrostered": ["NON_PARTICIPANT_ZERO", null, 0],
      "rb-cancel": ["NEUTRALIZED", null, null],
      "rb-moved": ["NEUTRALIZED", null, null],
    });
    expect(byId.get("rb-zero")!.participationState).toBe("PARTICIPATED_ZERO");
    expect(byId.get("rb-dnp")!.participationState).toBe("VERIFIED_NON_PARTICIPANT");
    expect(rb.result).toMatchObject({ eligiblePoolSize: 8, effectivePoolSize: 4, effectiveFieldSize: 3, effectiveAvailableSlots: 3, invalidatedCalledCount: 0 });
    // Eight eligible, two neutralized: three scoreable slots for the full-board honor.
    expect(rb.honorScoreableSlots).toBe(3);
  });

  it("ranks only the waiver pool, never the full field", () => {
    // qb-b is 2nd in the full field; without qb-a in the pool it is the pool's #1.
    const qb = ready(contestInput("QB", entries("qb-b", "qb-neg")));
    const qbB = qb.rows.find((row) => row.rankableEntryId === "re-qb-b")!;
    expect(qbB.canonicalPositionRank).toBe(2);
    expect(qbB.waiverPoolRank).toBe(1);
    expect(qb.rows.find((row) => row.rankableEntryId === "re-qb-neg")!).toMatchObject({ waiverPoolRank: 2, fpHundredths: -120 });
  });

  it("blocks a BYE that contradicts a frozen scheduled game until a current D3 resolution settles it", () => {
    const pool = [...RB_POOL(), entry("rb-bye")];
    expect(blockedCodes(contestInput("RB", pool))).toEqual(["UNRESOLVED_SNAPSHOT_CONFLICT"]);

    const neutralized = ready(contestInput("RB", pool, { resolutions: [resolution("rb-bye", "GB", "NEUTRALIZED")] }));
    expect(neutralized.rows.find((row) => row.rankableEntryId === "re-rb-bye")).toMatchObject({
      canonicalClass: "SNAPSHOT_CONFLICT",
      treatment: "NEUTRALIZED",
      conflictResolutionId: "resolution-rb-bye-1",
    });
    expect(neutralized.honorScoreableSlots).toBe(3);
    expect(neutralized.appliedResolutions).toHaveLength(1);

    const zero = ready(contestInput("RB", pool, { resolutions: [resolution("rb-bye", "GB", "NON_PARTICIPANT_ZERO")] }));
    expect(zero.rows.find((row) => row.rankableEntryId === "re-rb-bye")).toMatchObject({ treatment: "NON_PARTICIPANT_ZERO", fpHundredths: 0 });
    expect(zero.result.resolutionSetFingerprint).not.toBe(neutralized.result.resolutionSetFingerprint);
    expect(zero.result.resultFingerprint).not.toBe(neutralized.result.resultFingerprint);

    // A BYE has no ranked result to score as ranked.
    expect(blockedCodes(contestInput("RB", pool, { resolutions: [resolution("rb-bye", "GB", "SCORE_AS_RANKED")] }))).toEqual(["CONFLICT_RESOLUTION_NOT_APPLICABLE"]);
  });

  it("blocks a team change until resolved, then applies the resolution bound to that artifact and entry", () => {
    const pool = [entry("qb-a", { teamAtFreeze: "SEA" }), ...entries("qb-b", "qb-dnp")];
    expect(blockedCodes(contestInput("QB", pool))).toEqual(["UNRESOLVED_SNAPSHOT_CONFLICT"]);
    const resolved = ready(contestInput("QB", pool, { resolutions: [resolution("qb-a", "SEA", "SCORE_AS_RANKED")] }));
    expect(resolved.rows.find((row) => row.rankableEntryId === "re-qb-a")).toMatchObject({ treatment: "RANKED", waiverPoolRank: 1, conflictResolutionId: "resolution-qb-a-1" });
    // The same decision recorded against another entry does not apply.
    const misbound = { ...resolution("qb-a", "SEA", "SCORE_AS_RANKED"), snapshotEntryId: "se-qb-b" };
    expect(blockedCodes(contestInput("QB", pool, { resolutions: [misbound] }))).toEqual(["UNAPPLIED_CONFLICT_RESOLUTION", "UNRESOLVED_SNAPSHOT_CONFLICT"]);
    // A decision for a conflict this contest does not have is reported, not ignored.
    expect(blockedCodes(contestInput("QB", entries("qb-a", "qb-b"), { resolutions: [resolution("qb-a", "SEA", "SCORE_AS_RANKED")] }))).toEqual([
      "UNAPPLIED_CONFLICT_RESOLUTION",
    ]);
  });

  it("rejects incomplete, ambiguous or non-contract canonical inputs instead of inferring", () => {
    expect(blockedCodes(contestInput("QB", [...entries("qb-a"), entry("qb-ghost")]))).toEqual(["PARTICIPANT_NOT_IN_LEDGER"]);
    expect(blockedCodes(contestInput("QB", [entry("qb-a", { provider: "waivers-test" }), entry("qb-b")]))).toEqual(["IDENTITY_PROVIDER_NOT_CONTRACT"]);
    expect(blockedCodes(contestInput("QB", [entry("qb-a"), entry("qb-a", { snapshotEntryId: "se-qb-a2", rankableEntryId: "re-qb-a2" })]))).toEqual([
      "DUPLICATE_POOL_MATCH",
    ]);
    expect(blockedCodes(contestInput("DEF", [entry("def-sf", { externalId: "def-SEA" })]))).toEqual(["DEF_IDENTITY_MALFORMED"]);
    expect(blockedCodes(contestInput("QB", entries("qb-a", "qb-b"), { contentChecksum: "0".repeat(64) }))).toEqual(["ARTIFACT_CONTENT_INVALID"]);

    const blocked = structuredClone(VERIFIED);
    blocked.artifact.payload.participationLedger.find((row) => row.participantId === "qb-b")!.state = "ABSENT_UNRESOLVED";
    expect(blockedCodes(contestInput("QB", entries("qb-a", "qb-b"), { verified: blocked }))).toEqual(["CANONICAL_RESULT_BLOCKED"]);

    const missingEntry = structuredClone(VERIFIED);
    const qbSet = missingEntry.artifact.payload.resultSets.find((set) => set.positionCode === "QB")!;
    qbSet.entries = qbSet.entries.filter((e) => e.participantId !== "qb-a");
    expect(blockedCodes(contestInput("QB", entries("qb-a", "qb-b"), { verified: missingEntry }))).toEqual(["RESULT_ENTRY_MISSING"]);

    const mismatch = structuredClone(VERIFIED);
    mismatch.artifact.payload.resultSets.find((set) => set.positionCode === "QB")!.entries.find((e) => e.participantId === "qb-a")!.pointsHundredths = 2411;
    expect(blockedCodes(contestInput("QB", entries("qb-a", "qb-b"), { verified: mismatch }))).toEqual(["RESULT_ENTRY_MISMATCH"]);

    const noSet = structuredClone(VERIFIED);
    noSet.artifact.payload.resultSets = noSet.artifact.payload.resultSets.filter((set) => set.positionCode !== "TE");
    expect(blockedCodes(contestInput("TE", entries("te-dnp"), { verified: noSet }))).toEqual(["RESULT_SET_MISSING"]);
  });

  it("keeps invalidated called players as their own rows with the approved precedence", () => {
    const pool = [...entries("def-sf", "def-sea"), entry("def-was", { eligibility: "EXCLUDED" }), entry("def-lv", { eligibility: "EXCLUDED" })];
    const absent = entry("def-lar", { snapshotEntryId: "se-def-lar-v1" });
    const def = ready(contestInput("DEF", pool, { called: [entry("def-was"), entry("def-lv"), absent] }));
    const rows = new Map(def.rows.map((row) => [row.rankableEntryId, row]));
    expect(rows.get("re-def-was")).toMatchObject({
      category: "INVALIDATED_CALLED_PLAYER",
      treatment: "INVALIDATED_PRE_LOCK",
      fpHundredths: 0,
      waiverPoolRank: null,
      invalidationBasis: "NOT_ELIGIBLE_IN_PINNED_SNAPSHOT",
      snapshotEntryId: "se-def-was",
    });
    expect(rows.get("re-def-lv")).toMatchObject({ treatment: "NEUTRALIZED", neutralizationPrecedence: "D2_NEUTRALIZATION_OVER_C2_INVALIDATION" });
    expect(rows.get("re-def-lar")).toMatchObject({ category: "INVALIDATED_CALLED_PLAYER", invalidationBasis: "ABSENT_FROM_PINNED_SNAPSHOT", snapshotEntryId: null });
    // Invalidated rows never rank or change the eligible pool and its slots.
    expect(def.result).toMatchObject({ eligiblePoolSize: 2, effectivePoolSize: 2, effectiveAvailableSlots: 2, invalidatedCalledCount: 3 });
    expect(rows.get("re-def-sf")!.waiverPoolRank).toBe(1);
    expect(def.honorScoreableSlots).toBe(2);

    const ambiguous = [entry("def-lar", { snapshotEntryId: "se-a" }), entry("def-lar", { snapshotEntryId: "se-b", externalId: "def-LV" })];
    expect(blockedCodes(contestInput("DEF", pool, { called: ambiguous }))).toContain("CALLED_IDENTITY_AMBIGUOUS");
  });

  it("fails closed on a canonical BYE against an eligible entry frozen on bye, which no D3 decision can settle", () => {
    // Freeze never admits a bye player, so an eligible one is corrupt data.
    const eligibleBye = [...RB_POOL(), entry("rb-bye", { isByeAtFreeze: true })];
    expect(blockedCodes(contestInput("RB", eligibleBye))).toEqual(["UNRESOLVED_SNAPSHOT_CONFLICT"]);
    expect(blockedCodes(contestInput("RB", eligibleBye, { resolutions: [byeResolution("se-rb-bye", "NEUTRALIZED")] }))).toEqual([
      "UNAPPLIED_CONFLICT_RESOLUTION",
      "UNRESOLVED_SNAPSHOT_CONFLICT",
    ]);
  });

  describe("D3 lookup on the originally called entry of a player invalidated before lock", () => {
    // Called while scheduled (v1); the pre-lock correction froze the team on bye and excluded him.
    const pinnedBye = [...RB_POOL(), entry("rb-bye", { eligibility: "EXCLUDED", isByeAtFreeze: true })];
    const calledV1 = entry("rb-bye", { snapshotEntryId: "se-rb-bye-v1" });
    const corrected = (resolutions: WaiverGradingResolutionInput[] = [], called = [calledV1]) => contestInput("RB", pinnedBye, { called, resolutions });
    const byeRow = (build: Ready) => build.rows.find((row) => row.rankableEntryId === "re-rb-bye")!;

    it("finds the conflict on the called entry and requires an explicit decision", () => {
      const build = buildWaiverContestResult(corrected());
      expect(build.status).toBe("BLOCKED");
      expect(build.issues.map((i) => [i.code, i.snapshotEntryId])).toEqual([["UNRESOLVED_SNAPSHOT_CONFLICT", "se-rb-bye-v1"]]);
    });

    it("applies a NEUTRALIZED decision over the pre-lock invalidation, keeping the pinned row and slots", () => {
      const build = ready(corrected([byeResolution("se-rb-bye-v1", "NEUTRALIZED")]));
      expect(byeRow(build)).toMatchObject({
        category: "INVALIDATED_CALLED_PLAYER",
        snapshotEntryId: "se-rb-bye",
        invalidationBasis: "NOT_ELIGIBLE_IN_PINNED_SNAPSHOT",
        canonicalClass: "SNAPSHOT_CONFLICT",
        treatment: "NEUTRALIZED",
        neutralizationPrecedence: "D3_NEUTRALIZATION_OVER_C2_INVALIDATION",
        conflictResolutionId: "resolution-se-rb-bye-v1",
        fpHundredths: null,
      });
      expect(build.result).toMatchObject({ eligiblePoolSize: 8, effectiveAvailableSlots: 3, invalidatedCalledCount: 1 });
      expect(build.honorScoreableSlots).toBe(3);
      const graded = grade(build, ["rb-bye", "rb-a"]);
      expect(summary(graded)).toMatchObject({ outcomes: ["NEUTRALIZED", "IN_RESULT_FIELD"], max: 28 });
    });

    it("keeps the pre-lock invalidation for any other decision", () => {
      const build = ready(corrected([byeResolution("se-rb-bye-v1", "NON_PARTICIPANT_ZERO")]));
      expect(byeRow(build)).toMatchObject({ treatment: "INVALIDATED_PRE_LOCK", neutralizationPrecedence: null, fpHundredths: 0, conflictResolutionId: "resolution-se-rb-bye-v1" });
    });

    it("does not apply a decision recorded against the corrected bye entry", () => {
      expect(blockedCodes(corrected([byeResolution("se-rb-bye", "NEUTRALIZED")]))).toEqual(["UNAPPLIED_CONFLICT_RESOLUTION", "UNRESOLVED_SNAPSHOT_CONFLICT"]);
    });

    it("blocks when the original entry is also frozen on bye, or when two scheduled entries were called", () => {
      expect(blockedCodes(corrected([], [entry("rb-bye", { snapshotEntryId: "se-rb-bye-v1", isByeAtFreeze: true })]))).toEqual(["UNRESOLVED_SNAPSHOT_CONFLICT"]);
      const build = buildWaiverContestResult(corrected([], [calledV1, entry("rb-bye", { snapshotEntryId: "se-rb-bye-v0" })]));
      expect(build.status === "BLOCKED" && build.issues.map((i) => i.detail)).toEqual([
        `${SPECS.get("rb-bye")!.name}: canonical BYE against more than one originally called scheduled entry`,
      ]);
    });

    it("leaves the uncorrected path unchanged: a scheduled pinned entry still carries the conflict", () => {
      const pinnedScheduled = [...RB_POOL(), entry("rb-bye", { eligibility: "EXCLUDED" })];
      const input = (resolutions: WaiverGradingResolutionInput[]) => contestInput("RB", pinnedScheduled, { called: [calledV1], resolutions });
      expect(byeRow(ready(input([byeResolution("se-rb-bye", "NEUTRALIZED")])))).toMatchObject({ treatment: "NEUTRALIZED", conflictResolutionId: "resolution-se-rb-bye" });
      expect(blockedCodes(input([byeResolution("se-rb-bye-v1", "NEUTRALIZED")]))).toEqual(["UNAPPLIED_CONFLICT_RESOLUTION", "UNRESOLVED_SNAPSHOT_CONFLICT"]);
    });
  });

  it("blocks inactive or merged identities, eligible or invalidated, instead of grading them", () => {
    const merged = (id: string, options: EntryOptions = {}) => {
      const base = entry(id, { ...options, active: false });
      return { ...base, rankable: { ...base.rankable!, adminNotes: "Merged into re-other: duplicate" } };
    };
    expect(blockedCodes(contestInput("QB", [entry("qb-a", { active: false }), entry("qb-b")]))).toEqual(["IDENTITY_ENTRY_INACTIVE"]);
    expect(blockedCodes(contestInput("QB", [merged("qb-a"), entry("qb-b")]))).toEqual(["IDENTITY_ENTRY_MERGED"]);
    const invalidated = entry("qb-a", { eligibility: "EXCLUDED", active: false });
    expect(blockedCodes(contestInput("QB", [invalidated, entry("qb-b")], { called: [entry("qb-a", { snapshotEntryId: "se-qb-a-v1", active: false })] }))).toEqual([
      "IDENTITY_ENTRY_INACTIVE",
    ]);
  });
});

describe("board grades: WAIVER_EYEQ_V1 golden boards", () => {
  const rb = ready(contestInput("RB", RB_POOL()));

  it("scores exact podium hits, near misses and ties on the configured Top N", () => {
    // 33 + 28 + (10 + 3 - |3 - 2|) = 73 of 84 -> 86.90.
    expect(summary(grade(rb, ["rb-a", "rb-tie1", "rb-tie2"]))).toEqual({
      resultKind: "SCORED",
      earned: 73,
      max: 84,
      eyeq: 8690,
      honor: null,
      fpPerCall: 2230,
      fpPerSlot: 2230,
      outcomes: ["EXACT", "EXACT", "IN_RESULT_FIELD"],
    });
    // (10 + 3 - 1) + 28 + (10 + 3 - 2) = 51 of 84 -> 60.71.
    expect(summary(grade(rb, ["rb-tie1", "rb-tie2", "rb-a"]))).toMatchObject({ earned: 51, max: 84, eyeq: 6071, outcomes: ["IN_RESULT_FIELD", "EXACT", "IN_RESULT_FIELD"] });
  });

  it("scores outside-Top-N, participated-zero and DNP calls as 0 but keeps them scoreable", () => {
    // rb-zero ranks 4th (outside N = 3); rb-a at slot 2 earns 12; DNP earns 0. 12 of 84 -> 14.29.
    expect(summary(grade(rb, ["rb-zero", "rb-a", "rb-dnp"]))).toEqual({
      resultKind: "SCORED",
      earned: 12,
      max: 84,
      eyeq: 1429,
      honor: null,
      fpPerCall: 937,
      fpPerSlot: 937,
      outcomes: ["OUTSIDE_RESULT_FIELD", "IN_RESULT_FIELD", "NON_PARTICIPANT_ZERO"],
    });
  });

  it("drops neutralized calls from earned, max and the effective slots without compacting slots", () => {
    const g = grade(rb, ["rb-cancel", "rb-a"]);
    // rb-a stays in slot 2: 12 of 28; K = 3 - 1 = 2, k = 1 -> 0.85; 12/28 x 0.85 = 36.43.
    expect(summary(g)).toEqual({
      resultKind: "SCORED",
      earned: 12,
      max: 28,
      eyeq: 3643,
      honor: null,
      fpPerCall: 2810,
      fpPerSlot: 1405,
      outcomes: ["NEUTRALIZED", "IN_RESULT_FIELD"],
    });
    expect(g.board).toMatchObject({ neutralizedCallCount: 1, scoreableCallCount: 1, effectiveAvailableSlots: 2, coverageCallCount: 1 });
    expect(g.calls[1]).toMatchObject({ slot: 2, waiverPoolRank: 1, maxRawPoints: 28 });
  });

  it("applies coverage to partial boards", () => {
    // 33 + 28 of 61; k = 2 of K = 3 -> 0.90.
    expect(summary(grade(rb, ["rb-a", "rb-tie2"]))).toMatchObject({ earned: 61, max: 61, eyeq: 9000, honor: "PERFECT_CALL", fpPerCall: 2375, fpPerSlot: 1583 });
  });

  it("marks zero-call, all-neutralized and no-effective-slot boards N/A with Played YES/NO", () => {
    expect(grade(rb, []).board).toMatchObject({
      resultKind: "NA_ZERO_CALL",
      played: true,
      eyeqHundredths: null,
      awardedHonor: null,
      honorIneligibleReason: "ZERO_CALL_BOARD",
      fpPerCallHundredths: null,
      fpPerAvailableSlotHundredths: 0,
    });
    expect(grade(rb, ["rb-moved"]).board).toMatchObject({
      resultKind: "NA_ALL_NEUTRALIZED",
      played: false,
      eyeqHundredths: null,
      honorIneligibleReason: "ALL_CALLS_NEUTRALIZED",
      fpPerCallHundredths: null,
      fpPerAvailableSlotHundredths: null,
    });

    // Corrected pool emptied: the only call was invalidated before lock.
    const te = ready(contestInput("TE", [entry("te-a", { eligibility: "EXCLUDED" }), entry("te-neg", { eligibility: "EXCLUDED" })], { called: [entry("te-a")] }));
    expect(te.result.effectiveAvailableSlots).toBe(0);
    expect(grade(te, ["te-a"]).board).toMatchObject({
      resultKind: "NA_NO_EFFECTIVE_SLOTS",
      ungradableReason: "CORRECTED_POOL_EMPTY",
      played: false,
      eyeqHundredths: null,
      awardedHonor: null,
      slotOverflow: true,
      invalidatedCallCount: 1,
    });

    // One eligible DEF, its game cancelled; the other call was invalidated.
    const def = ready(contestInput("DEF", [entry("def-kc"), entry("def-sf", { eligibility: "EXCLUDED" })], { called: [entry("def-sf")] }));
    expect(def.honorScoreableSlots).toBe(0);
    expect(grade(def, ["def-kc", "def-sf"]).board).toMatchObject({
      resultKind: "NA_NO_EFFECTIVE_SLOTS",
      ungradableReason: "NEUTRALIZATIONS_CONSUMED_SLOTS",
      played: false,
      eyeqHundredths: null,
      awardedHonor: null,
    });
  });

  it("scores invalidated called players 0 and lets D2 neutralization win over invalidation", () => {
    const pool = [...entries("def-sf", "def-sea", "def-was"), entry("def-lar", { eligibility: "EXCLUDED" }), entry("def-lv", { eligibility: "EXCLUDED" })];
    const def = ready(contestInput("DEF", pool, { called: [entry("def-lar"), entry("def-lv")] }));
    const g = grade(def, ["def-was", "def-lar", "def-lv"]);
    expect(g.calls.map((c) => [c.outcome, c.earnedRawPoints, c.invalidatedPreLock, c.neutralizationPrecedence])).toEqual([
      ["EXACT", 33, false, null],
      ["INVALIDATED_PRE_LOCK", 0, true, null],
      ["NEUTRALIZED", null, true, "D2_NEUTRALIZATION_OVER_C2_INVALIDATION"],
    ]);
    // 33 of 61; K = 3 - 1 = 2, k = 2 -> 54.10.
    expect(g.board).toMatchObject({ earnedRawPoints: 33, maxRawPoints: 61, eyeqHundredths: 5410, awardedHonor: null, invalidatedCallCount: 2, neutralizedCallCount: 1 });
  });

  it("uses N = 5 for WR, including ties and calls outside the Top 5", () => {
    const wr = ready(contestInput("WR", entries("wr-a", "wr-b", "wr-c", "wr-d", "wr-e", "wr-f")));
    // Ranks 1, 2, 2, 2, 5, 6: 35 + 30 + (15 - 1) + (15 - 2) + 15 = 107 of 120 -> 89.17.
    expect(summary(grade(wr, ["wr-a", "wr-b", "wr-c", "wr-d", "wr-e"]))).toMatchObject({
      earned: 107,
      max: 120,
      eyeq: 8917,
      honor: null,
      fpPerCall: 1520,
      fpPerSlot: 1520,
      outcomes: ["EXACT", "EXACT", "IN_RESULT_FIELD", "IN_RESULT_FIELD", "EXACT"],
    });
    expect(grade(wr, ["wr-f"]).calls[0]).toMatchObject({ outcome: "OUTSIDE_RESULT_FIELD", earnedRawPoints: 0, maxRawPoints: 35 });
  });

  it("blocks boards that cannot be graded as locked", () => {
    const codes = (input: WaiverGradingBoardInput) => {
      const graded = gradeWaiverBoard(contestRef(rb), input);
      return graded.status === "BLOCKED" ? graded.issues.map((i) => i.code) : [];
    };
    const gap = board(["rb-a", "rb-tie1"]);
    expect(codes({ ...gap, calls: gap.calls.map((c, i) => ({ ...c, slot: i === 1 ? 3 : c.slot })) })).toEqual(["BOARD_SLOTS_NOT_CONTIGUOUS"]);
    expect(codes(board(["rb-a", "rb-bye"]))).toEqual(["BOARD_CALL_WITHOUT_POOL_ROW"]);
    expect(codes({ ...board(["rb-a"]), revisionKind: "CLEAR" })).toEqual(["BOARD_REVISION_INVALID"]);
    expect(codes({ ...board(["rb-a"]), revisionCallCount: 2 })).toEqual(["BOARD_REVISION_INVALID"]);
    // Four calls exceed both the 3-slot board and the 3 available slots.
    expect(codes(board(["rb-a", "rb-tie1", "rb-tie2", "rb-zero"]))).toEqual(["BOARD_CALLS_EXCEED_SLOTS", "BOARD_CALLS_EXCEED_SLOTS"]);
  });
});

describe("full-board honors on the scoreable slots (approved Stage 4B.4 rule)", () => {
  it("approved QB example: a DNP third QB keeps three slots, so two exact calls earn PERFECT CALL", () => {
    const qb = ready(contestInput("QB", entries("qb-a", "qb-b", "qb-dnp")));
    expect(qb.honorScoreableSlots).toBe(3);
    expect(summary(grade(qb, ["qb-a", "qb-b"]))).toMatchObject({ honor: "PERFECT_CALL", eyeq: 9000 });
  });

  it("approved QB example: a neutralized third player leaves two slots, so two exact calls earn PERFECT PODIUM", () => {
    // Three eligible DEF, the third's game cancelled: the same shape as the approved example.
    const def = ready(contestInput("DEF", entries("def-sf", "def-sea", "def-kc")));
    expect(def.honorScoreableSlots).toBe(2);
    const g = grade(def, ["def-sf", "def-sea"]);
    // Coverage still uses the effective available slots (3): 61 of 61 x 0.90.
    expect(summary(g)).toMatchObject({ honor: "PERFECT_PODIUM", earned: 61, max: 61, eyeq: 9000 });
    expect(grade(def, ["def-sf"]).board.awardedHonor).toBe("PERFECT_CALL");

    // A D3 NEUTRALIZED decision reduces the slots the same way; a D3 zero does not.
    const rbPool = [...entries("rb-a", "rb-tie1"), entry("rb-bye")];
    const d3Neutralized = ready(contestInput("RB", rbPool, { resolutions: [resolution("rb-bye", "GB", "NEUTRALIZED")] }));
    expect(d3Neutralized.honorScoreableSlots).toBe(2);
    expect(grade(d3Neutralized, ["rb-a", "rb-tie1"]).board.awardedHonor).toBe("PERFECT_PODIUM");
    const d3Zero = ready(contestInput("RB", rbPool, { resolutions: [resolution("rb-bye", "GB", "NON_PARTICIPANT_ZERO")] }));
    expect(d3Zero.honorScoreableSlots).toBe(3);
    expect(grade(d3Zero, ["rb-a", "rb-tie1"]).board.awardedHonor).toBe("PERFECT_CALL");
  });

  it("awards the small-pool honor when the eligible pool is smaller than the field", () => {
    const te = ready(contestInput("TE", entries("te-a", "te-neg")));
    expect(te.honorScoreableSlots).toBe(2);
    expect(summary(grade(te, ["te-a", "te-neg"]))).toMatchObject({ honor: "PERFECT_PODIUM", eyeq: 10000, fpPerCall: 540 });
    expect(grade(te, ["te-a"]).board.awardedHonor).toBe("PERFECT_CALL");

    const wrSmall = ready(contestInput("WR", entries("wr-a", "wr-b", "wr-e"), { verified: VERIFIED_DISTINCT_WR }));
    expect(summary(grade(wrSmall, ["wr-a", "wr-b", "wr-e"]))).toMatchObject({ honor: "PERFECT_FIVE", earned: 90, max: 90, eyeq: 10000 });
  });

  it("awards PERFECT FIVE / PODIUM on a full field only for every slot exact", () => {
    const wr = ready(contestInput("WR", entries("wr-a", "wr-b", "wr-c", "wr-d", "wr-e", "wr-f"), { verified: VERIFIED_DISTINCT_WR }));
    expect(wr.honorScoreableSlots).toBe(5);
    expect(summary(grade(wr, ["wr-a", "wr-b", "wr-c", "wr-d", "wr-e"]))).toMatchObject({ honor: "PERFECT_FIVE", earned: 120, eyeq: 10000 });
    expect(grade(wr, ["wr-a", "wr-b", "wr-c", "wr-d"]).board.awardedHonor).toBe("PERFECT_CALL");
    expect(grade(wr, ["wr-a", "wr-b", "wr-c", "wr-d", "wr-f"]).board.awardedHonor).toBeNull();
  });

  it("never completes a full board with a neutralized call, a tie miss, a DNP or a zero-call board", () => {
    const def = ready(contestInput("DEF", entries("def-sf", "def-sea", "def-kc")));
    // Two exact calls fill S = 2, but the board also called the cancelled DEF.
    expect(grade(def, ["def-sf", "def-sea", "def-kc"]).board.awardedHonor).toBe("PERFECT_CALL");
    expect(grade(def, []).board.awardedHonor).toBeNull();

    const rb = ready(contestInput("RB", RB_POOL()));
    expect(grade(rb, ["rb-a", "rb-tie1", "rb-tie2"]).board.awardedHonor).toBeNull();
    expect(grade(rb, ["rb-a", "rb-tie1", "rb-dnp"]).board.awardedHonor).toBeNull();
    // Fewer positive scorers do not shrink the slots: a negative and a DNP still occupy them.
    const qb = ready(contestInput("QB", entries("qb-a", "qb-neg", "qb-dnp")));
    expect(grade(qb, ["qb-a", "qb-neg"]).board.awardedHonor).toBe("PERFECT_CALL");
  });
});

describe("AI and human parity", () => {
  it("grades an ADMIN_COMPETITIVE_OVERRIDE AI board exactly like a human board with the same calls", () => {
    const rb = ready(contestInput("RB", RB_POOL()));
    const human = grade(rb, ["rb-a", "rb-cancel", "rb-tie1"], { submissionId: "sub-human" });
    const ai = grade(rb, ["rb-a", "rb-cancel", "rb-tie1"], { submissionId: "sub-ai", competitor: AI_OVERRIDE });
    const strip = (g: typeof human) => ({
      board: { ...g.board, submissionId: null, revisionId: null, inputFingerprint: null },
      calls: g.calls.map((c) => ({ ...c, callId: null, inputFingerprint: null })),
    });
    expect(strip(ai)).toEqual(strip(human));
    expect(ai.board.outputFingerprint).toBe(human.board.outputFingerprint);
    expect(ai.competitor.entryBasis).toBe("ADMIN_COMPETITIVE_OVERRIDE");
  });
});

describe("reproducibility and week assembly", () => {
  const pool = [...RB_POOL(), entry("rb-bye")];
  const resolutions = [resolution("rb-bye", "GB", "NEUTRALIZED")];

  it("produces identical results and fingerprints for permuted inputs", () => {
    const a = ready(contestInput("RB", pool, { resolutions, called: entries("rb-a", "rb-dnp") }));
    const b = ready(contestInput("RB", [...pool].reverse(), { resolutions: [...resolutions].reverse(), called: entries("rb-dnp", "rb-a") }));
    expect(b).toEqual(a);
    const boards = [board(["rb-a", "rb-tie2"]), board(["rb-dnp"]), board([])];
    const gradedA = boards.map((input) => gradeWaiverBoard(contestRef(a), input));
    const gradedB = boards.map((input) => gradeWaiverBoard(contestRef(b), input));
    expect(gradedB).toEqual(gradedA);
  });

  function week(positions: Partial<Record<WaiverPosition, WaiverWeekPositionInput>>, order: WaiverPosition[] = [...WAIVER_POSITIONS]) {
    return assembleWaiverWeekGrading({
      week: { id: "week-5", season: 2026, weekNumber: 5 },
      artifact: { rowId: "artifact-row-1", artifactId: VERIFIED.summary.artifactId, seriesKey: VERIFIED.summary.seriesKey, revision: 1, contentChecksum: VERIFIED.summary.contentChecksum },
      positions: order.map((position) => positions[position] ?? { position, kind: "EMPTY", snapshotId: "snapshot-2", snapshotFingerprint: "snapshot-fp" }),
      issues: [],
      advisories: [],
    });
  }

  it("assembles all five positions into a deterministic run preview and reports every board", () => {
    const rbBuild = buildWaiverContestResult(contestInput("RB", RB_POOL()));
    const defBuild = buildWaiverContestResult(contestInput("DEF", entries("def-sf", "def-sea", "def-kc")));
    const inactiveAi: WaiverCompetitor = { ...AI_OVERRIDE, universalProfileId: "profile-ai-inactive", competitorActive: false, entryBasis: "STANDARD" };
    const positions = {
      RB: { position: "RB", kind: "CONTEST", contestId: "contest-RB", build: rbBuild, boards: [board(["rb-a", "rb-tie2"]), board([])] },
      DEF: {
        position: "DEF",
        kind: "CONTEST",
        contestId: "contest-DEF",
        build: defBuild,
        boards: [board(["def-sf", "def-sea"], { competitor: AI_OVERRIDE }), board(["def-sea"], { submissionId: "sub-inactive", competitor: inactiveAi })],
      },
    } satisfies Partial<Record<WaiverPosition, WaiverWeekPositionInput>>;
    const preview = week(positions);
    expect(preview.status).toBe("READY");
    expect(preview.positions.map((p) => p.kind)).toEqual(["EMPTY_ELIGIBLE_POOL", "CONTEST_RESULT", "EMPTY_ELIGIBLE_POOL", "EMPTY_ELIGIBLE_POOL", "CONTEST_RESULT"]);
    expect(preview.summary).toEqual({
      boards: 4,
      byResultKind: { SCORED: 3, NA_ZERO_CALL: 1 },
      byHonor: { PERFECT_CALL: 1, NONE: 2, PERFECT_PODIUM: 1 },
      byProfileType: { HUMAN: 2, AI: 2 },
      byEntryBasis: { STANDARD: 3, ADMIN_COMPETITIVE_OVERRIDE: 1 },
    });
    // Inactive competitors' locked boards are graded and surfaced, never dropped.
    expect(preview.boards.some((b) => b.board.submissionId === "sub-inactive")).toBe(true);
    expect(preview.advisories.map((a) => a.code)).toEqual(["INACTIVE_COMPETITOR_LOCKED_BOARD"]);

    const reordered = week(
      {
        ...positions,
        RB: { ...positions.RB, boards: [...positions.RB.boards].reverse() },
        DEF: { ...positions.DEF, boards: [...positions.DEF.boards].reverse() },
      },
      [...WAIVER_POSITIONS].reverse(),
    );
    expect(reordered.run).toEqual(preview.run);
    expect(reordered.boards).toEqual(preview.boards);
    expect(preview.run!.boardGradeCount).toBe(4);
  });

  it("blocks the whole week when any position is blocked, and requires all five positions", () => {
    const blocked = buildWaiverContestResult(contestInput("QB", [entry("qb-a"), entry("qb-ghost")]));
    const preview = week({ QB: { position: "QB", kind: "CONTEST", contestId: "contest-QB", build: blocked, boards: [] } });
    expect(preview.status).toBe("BLOCKED");
    expect(preview.run).toBeNull();
    expect(preview.issues.map((i) => i.code)).toEqual(["PARTICIPANT_NOT_IN_LEDGER"]);
    expect(week({}).status).toBe("BLOCKED");
    expect(() => week({}, ["QB", "RB", "WR", "TE"])).toThrow(RangeError);
  });
});
