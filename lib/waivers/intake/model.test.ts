import { describe, expect, it } from "vitest";
import { buildSyntheticCanonicalArtifact, SYNTHETIC_PARTICIPANTS, syntheticPlayerExternalId } from "@/lib/waivers/__fixtures__/canonical-artifact";
import { verifySngCanonicalArtifact, type VerifiedSngCanonicalArtifact } from "@/lib/waivers/canonical/artifact-verifier";
import { detectSnapshotCanonicalConflicts } from "@/lib/waivers/canonical/policy";
import type { PreflightSnapshotEntry } from "@/lib/waivers/canonical/preflight-model";
import { RANKEYEQ_SNG_TEAM_CROSSWALK_VERSION, rankEyeQTeamForSngTeamKey } from "@/lib/waivers/canonical/team-crosswalk";
import { WAIVER_EYEQ_V1, WAIVER_MAX_CALLS, WAIVER_RESULT_FIELD_SIZE, type WaiverPosition } from "@/lib/waivers/constants";
import {
  evaluateWaiverResultsIntake,
  type WaiverIntakeArtifactInput,
  type WaiverIntakeBoardInput,
  type WaiverIntakePositionInput,
  type WaiverIntakeResolution,
} from "@/lib/waivers/intake/model";

function verify(sealed: { bytes: string }): VerifiedSngCanonicalArtifact {
  const checked = verifySngCanonicalArtifact(sealed.bytes, { expectedSeason: 2026, expectedWeek: 5 });
  if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
  return { artifact: checked.artifact, summary: checked.summary };
}

const VERIFIED = verify(buildSyntheticCanonicalArtifact());
const SPECS = new Map(SYNTHETIC_PARTICIPANTS.map((spec) => [spec.id, spec]));
const WEEK = { id: "week-5", season: 2026, weekNumber: 5 };

type EntryOptions = { eligibility?: string; isByeAtFreeze?: boolean; externalId?: string; snapshotEntryId?: string; rankableEntryId?: string; frozen?: boolean };

function entry(id: string, options: EntryOptions = {}): PreflightSnapshotEntry {
  const spec = SPECS.get(id) ?? { id, position: id.split("-")[0].toUpperCase() as WaiverPosition, teamKey: "san-francisco-49ers", name: id };
  const team = rankEyeQTeamForSngTeamKey(spec.teamKey)!.rankeyeqTeam;
  const externalId = options.externalId ?? (spec.position === "DEF" ? `def-${team}` : syntheticPlayerExternalId(id));
  const identity = { provider: "nflcom-bootstrap", externalId };
  return {
    snapshotEntryId: options.snapshotEntryId ?? `se-${id}`,
    rankableEntryId: options.rankableEntryId ?? `re-${id}`,
    position: spec.position,
    evidenceRole: "CANDIDATE",
    eligibility: options.eligibility ?? "ELIGIBLE",
    displayNameAtFreeze: spec.name ?? id,
    teamAtFreeze: team,
    isByeAtFreeze: options.isByeAtFreeze ?? false,
    frozenIdentity: options.frozen === false ? null : identity,
    rankable: { ...identity, team, active: true, adminNotes: null, name: spec.name ?? id },
  };
}

const POOLS: Record<WaiverPosition, string[]> = {
  QB: ["qb-a", "qb-b", "qb-neg", "qb-dnp"],
  RB: ["rb-a", "rb-tie1", "rb-tie2", "rb-zero", "rb-cancel"],
  WR: ["wr-a", "wr-b", "wr-c", "wr-d", "wr-e", "wr-f"],
  TE: ["te-a", "te-dnp", "te-neg"],
  DEF: ["def-sf", "def-sea", "def-was", "def-lar", "def-kc"],
};

type ContestOptions = {
  pool?: PreflightSnapshotEntry[];
  called?: PreflightSnapshotEntry[];
  boards?: WaiverIntakeBoardInput[];
  status?: string;
  maxCalls?: number;
  unstamped?: number;
  isCurrent?: boolean;
  resolutions?: WaiverIntakeResolution[];
};

function board(id: string, called: PreflightSnapshotEntry[], competitor: Partial<WaiverIntakeBoardInput["competitor"]> = {}, overrides: Partial<WaiverIntakeBoardInput> = {}): WaiverIntakeBoardInput {
  return {
    submissionId: `sub-${id}`,
    revisionId: `rev-${id}`,
    revisionFingerprint: `rev-fp-${id}`,
    revisionKind: "SUBMISSION",
    revisionCallCount: called.length,
    competitor: { universalProfileId: `profile-${id}`, profileType: "HUMAN", competitorActive: true, entryBasis: "STANDARD", ...competitor },
    calls: called.map((entry, i) => ({ slot: i + 1, entry })),
    ...overrides,
  };
}

function contest(position: WaiverPosition, options: ContestOptions = {}): WaiverIntakePositionInput {
  return {
    position,
    kind: "CONTEST",
    contest: {
      id: `contest-${position}`,
      status: options.status ?? "LOCKED",
      snapshotId: "snapshot-2",
      scoringVersion: WAIVER_EYEQ_V1.slug,
      maxCalls: options.maxCalls ?? WAIVER_MAX_CALLS[position],
      resultFieldSize: WAIVER_RESULT_FIELD_SIZE[position],
    },
    snapshot: {
      id: "snapshot-2",
      version: 2,
      entriesFingerprint: "entries-fp-2",
      isCurrent: options.isCurrent ?? true,
      entries: options.pool ?? POOLS[position].map((id) => entry(id)),
    },
    boards: options.boards ?? [board(`${position}-human`, options.called ?? [])],
    unstampedBoardCount: options.unstamped ?? 0,
    resolutions: options.resolutions ?? [],
  };
}

function artifact(overrides: Partial<WaiverIntakeArtifactInput> = {}): WaiverIntakeArtifactInput {
  return {
    rowId: "artifact-row-1",
    artifactId: VERIFIED.summary.artifactId,
    seriesKey: VERIFIED.summary.seriesKey,
    revision: VERIFIED.summary.revision,
    contentChecksum: VERIFIED.summary.contentChecksum,
    weekId: WEEK.id,
    defCrosswalkVersion: RANKEYEQ_SNG_TEAM_CROSSWALK_VERSION,
    latestState: "ACCEPTED",
    latestSequence: 1,
    newerRevisions: 0,
    verification: { ok: true, verified: VERIFIED },
    ...overrides,
  };
}

const allContests = (replace: Partial<Record<WaiverPosition, WaiverIntakePositionInput>> = {}) =>
  (["QB", "RB", "WR", "TE", "DEF"] as const).map((position) => replace[position] ?? contest(position));

const evaluate = (positions = allContests(), artifactInput = artifact()) => evaluateWaiverResultsIntake({ week: WEEK, artifact: artifactInput, positions });
const codes = (intake: ReturnType<typeof evaluate>) => intake.issues.map((i) => [i.stage, i.code, i.position ?? null]);

/** A D3 resolution of the BYE conflict on a pool row bound to this artifact. */
function byeResolution(pooled: PreflightSnapshotEntry, participantId: string, overrides: Partial<WaiverIntakeResolution> = {}): WaiverIntakeResolution {
  const [conflict] = detectSnapshotCanonicalConflicts({
    artifactContentChecksum: VERIFIED.summary.contentChecksum,
    snapshotEntryId: pooled.snapshotEntryId,
    snapshot: { isByeAtFreeze: false, teamAtFreeze: pooled.teamAtFreeze },
    canonical: { participantId, cls: "SNAPSHOT_CONFLICT", disposition: "BYE", teamKey: "green-bay-packers" },
  });
  return {
    id: `resolution-${participantId}`,
    conflictKey: conflict.conflictKey,
    sequence: 1,
    conflictKind: conflict.kind,
    resolution: "NEUTRALIZED",
    snapshotEntryId: pooled.snapshotEntryId,
    sngParticipantId: participantId,
    ...overrides,
  };
}

describe("results intake model", () => {
  it("reconciles a complete week and is ready for the grading preview", () => {
    const intake = evaluate();
    expect(intake.issues).toEqual([]);
    expect(intake.status).toBe("READY_FOR_GRADING_PREVIEW");
    expect(intake.artifact).toMatchObject({ gradable: true, contentVerified: true });
    expect(intake.positions.map((p) => [p.position, p.kind, p.eligiblePoolSize, p.matchedCount, p.rows.length])).toEqual([
      ["QB", "CONTEST", 4, 4, 4],
      ["RB", "CONTEST", 5, 5, 5],
      ["WR", "CONTEST", 6, 6, 6],
      ["TE", "CONTEST", 3, 3, 3],
      ["DEF", "CONTEST", 5, 5, 5],
    ]);
    expect(intake.positions.find((p) => p.position === "QB")!.byClass).toEqual({ RANKED: 3, NON_PARTICIPANT: 1 });
    expect(intake.facts).toMatchObject({ participantCount: SYNTHETIC_PARTICIPANTS.length });
    expect(intake.acknowledgmentsRequired.map((a) => a.code)).toEqual(["OPERATOR_ATTESTED_AUTHORITY", "DEF_CROSSWALK_PENDING_PRODUCER_CONFIRMATION"]);
    expect(evaluate()).toEqual(intake);
  });

  it("only the latest ACCEPTED, intact revision of the week is gradable", () => {
    const gate = (overrides: Partial<WaiverIntakeArtifactInput>) => {
      const intake = evaluate(allContests(), artifact(overrides));
      expect([intake.status, intake.artifact.gradable]).toEqual(["ARTIFACT_NOT_GRADABLE", false]);
      return intake.issues.filter((i) => i.stage === "ARTIFACT").map((i) => i.code);
    };
    expect(gate({ latestState: "WITHDRAWN", latestSequence: 2 })).toEqual(["ARTIFACT_NOT_ACCEPTED"]);
    expect(gate({ newerRevisions: 1 })).toEqual(["ARTIFACT_NOT_LATEST"]);
    expect(gate({ weekId: "week-6" })).toEqual(["ARTIFACT_WEEK_MISMATCH"]);
    expect(gate({ defCrosswalkVersion: "rankeyeq-sng-team-crosswalk/0" })).toEqual(["DEF_CROSSWALK_VERSION_MISMATCH"]);
    expect(gate({ contentChecksum: "0".repeat(64) })).toEqual(["ARTIFACT_CONTENT_INVALID"]);
    const unreadable = evaluate(allContests(), artifact({ verification: { ok: false, issueCodes: ["CONTENT_CHECKSUM_MISMATCH"] } }));
    expect([unreadable.status, unreadable.facts, unreadable.positions.every((p) => p.rows.length === 0)]).toEqual(["ARTIFACT_NOT_GRADABLE", null, true]);
    const otherWeek = evaluateWaiverResultsIntake({ week: { ...WEEK, weekNumber: 6 }, artifact: artifact(), positions: allContests() });
    expect(otherWeek.issues.map((i) => i.code)).toEqual(["ARTIFACT_WEEK_MISMATCH"]);
  });

  it("blocks on competition state: unlocked contests, unstamped boards, missing contests or snapshots", () => {
    const intake = evaluate(allContests({ QB: contest("QB", { status: "OPEN" }), RB: contest("RB", { unstamped: 1 }), DEF: { position: "DEF", kind: "NO_CONTEST", currentSnapshot: { id: "snapshot-2", eligibleAtPosition: 3 } } }));
    expect(intake.status).toBe("INTAKE_BLOCKED");
    expect(codes(intake)).toEqual([
      ["COMPETITION", "CONTEST_NOT_LOCKED", "QB"],
      ["COMPETITION", "SUBMISSION_NOT_LOCK_STAMPED", "RB"],
      ["COMPETITION", "CONTEST_MISSING", "DEF"],
    ]);
    const noSnapshot = evaluate(allContests({ DEF: { position: "DEF", kind: "NO_CONTEST", currentSnapshot: null } }));
    expect(codes(noSnapshot)).toEqual([["COMPETITION", "CURRENT_SNAPSHOT_MISSING", "DEF"]]);
  });

  it("an empty eligible pool needs no contest, and drops the DEF crosswalk acknowledgment", () => {
    const intake = evaluate(allContests({ DEF: { position: "DEF", kind: "NO_CONTEST", currentSnapshot: { id: "snapshot-2", eligibleAtPosition: 0 } } }));
    expect(intake.status).toBe("READY_FOR_GRADING_PREVIEW");
    expect(intake.positions.find((p) => p.position === "DEF")).toMatchObject({ kind: "EMPTY_ELIGIBLE_POOL", snapshotId: "snapshot-2", artifactFieldSize: VERIFIED.artifact.payload.resultSets.find((s) => s.positionCode === "DEF")!.fieldSize });
    expect(intake.acknowledgmentsRequired.map((a) => a.code)).toEqual(["OPERATOR_ATTESTED_AUTHORITY"]);
  });

  it("blocks when a pool member has no canonical result or two rows match one participant", () => {
    const ghost = entry("qb-ghost");
    const intake = evaluate(allContests({ QB: contest("QB", { pool: [...POOLS.QB.map((id) => entry(id)), ghost] }) }));
    expect(intake.status).toBe("INTAKE_BLOCKED");
    expect(intake.issues.map((i) => [i.stage, i.code, i.position, i.snapshotEntryId])).toEqual([["RECONCILIATION", "PARTICIPANT_NOT_IN_LEDGER", "QB", ghost.snapshotEntryId]]);
    expect(intake.positions[0].rows.find((r) => r.snapshotEntryId === ghost.snapshotEntryId)).toMatchObject({ sngParticipantId: null, issueCodes: ["PARTICIPANT_NOT_IN_LEDGER"] });
    expect(intake.positions[0].matchedCount).toBe(4);

    const twin = entry("wr-a", { snapshotEntryId: "se-wr-a-twin", rankableEntryId: "re-wr-a-twin" });
    const duplicate = evaluate(allContests({ WR: contest("WR", { pool: [...POOLS.WR.map((id) => entry(id)), twin] }) }));
    expect(codes(duplicate)).toEqual([["RECONCILIATION", "DUPLICATE_POOL_MATCH", "WR"]]);
  });

  it("accounts for players called on locked boards but invalidated in the pinned snapshot", () => {
    const excluded = entry("qb-neg", { eligibility: "EXCLUDED" });
    const pool = [...["qb-a", "qb-b", "qb-dnp"].map((id) => entry(id)), excluded];
    const intake = evaluate(allContests({ QB: contest("QB", { pool, called: [excluded, entry("qb-a")] }) }));
    expect(intake.status).toBe("READY_FOR_GRADING_PREVIEW");
    const qb = intake.positions[0];
    expect([qb.eligiblePoolSize, qb.invalidatedCalledCount, qb.rows.length]).toEqual([3, 1, 4]);
    expect(qb.rows.find((r) => r.category === "INVALIDATED_CALLED_PLAYER")).toMatchObject({ sngParticipantId: "qb-neg", cls: "RANKED", issueCodes: [] });
  });

  it("lists canonical BYE conflicts as D3 decisions and recognizes exactly matching current resolutions", () => {
    const bye = entry("rb-bye");
    const pool = [...POOLS.RB.map((id) => entry(id)), bye];
    const pending = evaluate(allContests({ RB: contest("RB", { pool }) }));
    expect(pending.status).toBe("D3_DECISIONS_REQUIRED");
    expect(pending.issues).toEqual([]);
    expect([pending.decisionsRequired, pending.decisionsResolved]).toEqual([1, 0]);
    const [conflict] = pending.positions[1].conflicts;
    expect(conflict).toMatchObject({ kind: "BYE_VS_SCHEDULED", snapshotEntryId: bye.snapshotEntryId, sngParticipantId: "rb-bye", status: "DECISION_REQUIRED", resolution: null });

    const resolution = byeResolution(bye, "rb-bye");
    const resolved = evaluate(allContests({ RB: contest("RB", { pool, resolutions: [resolution] }) }));
    expect([resolved.status, resolved.decisionsRequired, resolved.decisionsResolved]).toEqual(["READY_FOR_GRADING_PREVIEW", 0, 1]);
    expect(resolved.positions[1].conflicts[0]).toMatchObject({ status: "RESOLVED", resolution: { id: resolution.id, sequence: 1, treatment: "NEUTRALIZED" } });
    expect(resolved.intakeFingerprint).not.toBe(pending.intakeFingerprint);

    const mismatched = evaluate(allContests({ RB: contest("RB", { pool, resolutions: [{ ...resolution, sngParticipantId: "rb-a" }] }) }));
    expect(mismatched.positions[1].conflicts[0].status).toBe("RESOLUTION_MISMATCH");
    expect([mismatched.status, codes(mismatched)]).toEqual(["INTAKE_BLOCKED", [["RECONCILIATION", "UNAPPLIED_CONFLICT_RESOLUTION", "RB"]]]);

    const scored = evaluate(allContests({ RB: contest("RB", { pool, resolutions: [{ ...resolution, resolution: "SCORE_AS_RANKED" }] }) }));
    expect(codes(scored)).toEqual([["RECONCILIATION", "CONFLICT_RESOLUTION_NOT_APPLICABLE", "RB"]]);

    const stray = evaluate(allContests({ QB: contest("QB", { resolutions: [{ ...resolution, id: "stray" }] }) }));
    expect(codes(stray)).toEqual([["RECONCILIATION", "UNAPPLIED_CONFLICT_RESOLUTION", "QB"]]);
  });

  it("asks for identity evidence when rows match on the live key, and flags a non-current pinned snapshot", () => {
    const intake = evaluate(allContests({ TE: contest("TE", { pool: POOLS.TE.map((id) => entry(id, { frozen: id !== "te-a" })), isCurrent: false }) }));
    expect(intake.status).toBe("READY_FOR_GRADING_PREVIEW");
    expect(intake.acknowledgmentsRequired.map((a) => a.code)).toContain("IDENTITY_KEY_NOT_FROZEN_AT_SNAPSHOT");
    expect(intake.positions[3].rows.find((r) => r.snapshotEntryId === "se-te-a")!.identitySource).toBe("LIVE_NOT_FROZEN");
    expect(intake.advisories.map((a) => [a.code, a.position])).toEqual([["CONTEST_SNAPSHOT_NOT_CURRENT", "TE"]]);
  });

  it("fingerprints the reviewed state, not object identity", () => {
    const a = evaluate();
    expect(evaluate(allContests().reverse()).intakeFingerprint).toBe(a.intakeFingerprint);
    expect(evaluate(allContests(), artifact({ latestSequence: 3 })).intakeFingerprint).not.toBe(a.intakeFingerprint);
    expect(evaluate(allContests({ WR: contest("WR", { boards: [board("WR-human", []), board("WR-two", [])] }) })).intakeFingerprint).not.toBe(a.intakeFingerprint);
    expect(evaluate(allContests({ WR: contest("WR", { boards: [board("WR-human", [], { competitorActive: false })] }) })).intakeFingerprint).not.toBe(a.intakeFingerprint);
  });

  it("applies the status precedence: artifact gate, then blockers, then D3 decisions, then ready", () => {
    const bye = entry("rb-bye");
    const rbPool = [...POOLS.RB.map((id) => entry(id)), bye];
    const withDecision = { RB: contest("RB", { pool: rbPool }) };
    const withBlocker = { QB: contest("QB", { status: "OPEN" }) };
    const withdrawn = artifact({ latestState: "WITHDRAWN" });
    const status = (positions: WaiverIntakePositionInput[], a = artifact()) => evaluate(positions, a).status;
    expect(status(allContests({ ...withDecision, ...withBlocker }), withdrawn)).toBe("ARTIFACT_NOT_GRADABLE");
    expect(status(allContests(withDecision), withdrawn)).toBe("ARTIFACT_NOT_GRADABLE");
    expect(status(allContests(), withdrawn)).toBe("ARTIFACT_NOT_GRADABLE");
    expect(status(allContests({ ...withDecision, ...withBlocker }))).toBe("INTAKE_BLOCKED");
    expect(status(allContests(withBlocker))).toBe("INTAKE_BLOCKED");
    expect(status(allContests(withDecision))).toBe("D3_DECISIONS_REQUIRED");
    expect(status(allContests())).toBe("READY_FOR_GRADING_PREVIEW");
    const blocked = evaluate(allContests({ ...withDecision, ...withBlocker }));
    expect([blocked.decisionsRequired, blocked.positions[1].conflicts[0].status]).toEqual([1, "DECISION_REQUIRED"]);
  });

  it("no unfit artifact can reach ready, whatever the competition state", () => {
    const unfit: Array<[string, Partial<WaiverIntakeArtifactInput>, typeof WEEK?]> = [
      ["superseded", { latestState: "SUPERSEDED", newerRevisions: 1 }],
      ["stale", { newerRevisions: 2 }],
      ["withdrawn", { latestState: "WITHDRAWN" }],
      ["no publication event", { latestState: null, latestSequence: null }],
      ["wrong week row", { weekId: "week-4" }],
      ["wrong season", {}, { ...WEEK, season: 2025 }],
      ["crosswalk-incompatible", { defCrosswalkVersion: "rankeyeq-sng-team-crosswalk/2" }],
      ["content invalid", { verification: { ok: false, issueCodes: ["SCHEMA_INVALID"] } }],
      ["row checksum differs", { contentChecksum: "f".repeat(64) }],
    ];
    for (const [label, overrides, week] of unfit) {
      const intake = evaluateWaiverResultsIntake({ week: week ?? WEEK, artifact: artifact(overrides), positions: allContests() });
      expect([label, intake.status, intake.artifact.gradable]).toEqual([label, "ARTIFACT_NOT_GRADABLE", false]);
    }
  });

  it("reviews every locked board, human or not, active or not, including admin competitive overrides", () => {
    const boards = [
      board("human", [entry("te-a")]),
      board("ai", [entry("te-a"), entry("te-neg")], { profileType: "AI" }),
      board("override", [entry("te-neg")], { profileType: "AI", competitorActive: false, entryBasis: "ADMIN_COMPETITIVE_OVERRIDE" }),
      board("late", [entry("te-a")], { profileType: "AI", entryBasis: "AI_LATE_ENTRY" }),
    ];
    const intake = evaluate(allContests({ TE: contest("TE", { boards }) }));
    expect(intake.status).toBe("READY_FOR_GRADING_PREVIEW");
    expect(intake.positions[3]).toMatchObject({ lockedBoardCount: 4, lockedBoards: { human: 1, nonHuman: 3, adminOverride: 1, aiLateEntry: 1, inactiveNonHuman: 1 } });
    expect(intake.advisories.map((a) => [a.code, a.position])).toEqual([["INACTIVE_COMPETITOR_LOCKED_BOARD", "TE"]]);

    // A player called only on the inactive override board is still accounted for.
    const excluded = entry("te-dnp", { eligibility: "EXCLUDED" });
    const pool = [entry("te-a"), entry("te-neg"), excluded];
    const onlyOverride = evaluate(allContests({ TE: contest("TE", { pool, boards: [board("human", [entry("te-a")]), board("override", [excluded], { profileType: "AI", competitorActive: false, entryBasis: "ADMIN_COMPETITIVE_OVERRIDE" })] }) }));
    expect(onlyOverride.positions[3].rows.find((r) => r.category === "INVALIDATED_CALLED_PLAYER")).toMatchObject({ snapshotEntryId: excluded.snapshotEntryId, sngParticipantId: "te-dnp" });
  });

  it("blocks on the grading engine's board and contest-rule checks", () => {
    const two = [entry("qb-a"), entry("qb-b")];
    const boardCodes = (boards: WaiverIntakeBoardInput[], options: ContestOptions = {}) =>
      evaluate(allContests({ QB: contest("QB", { ...options, boards }) })).issues.map((i) => [i.code, i.submissionId ?? null]);
    expect(boardCodes([board("kind", two, {}, { revisionKind: "AUTOSAVE" })])).toEqual([["BOARD_REVISION_INVALID", "sub-kind"]]);
    expect(boardCodes([board("count", two, {}, { revisionCallCount: 3 })])).toEqual([["BOARD_REVISION_INVALID", "sub-count"]]);
    expect(boardCodes([board("gap", two, {}, { calls: [{ slot: 1, entry: two[0] }, { slot: 3, entry: two[1] }] })])).toEqual([["BOARD_SLOTS_NOT_CONTIGUOUS", "sub-gap"]]);
    const four = ["qb-a", "qb-b", "qb-neg", "qb-dnp"].map((id) => entry(id));
    expect(boardCodes([board("four", four)])).toEqual([
      ["BOARD_CALLS_EXCEED_SLOTS", "sub-four"],
      ["BOARD_CALLS_EXCEED_SLOTS", "sub-four"],
    ]);
    const smallPool = [entry("qb-a"), entry("qb-b")];
    // An invalidated call never counts against the available slots.
    expect(boardCodes([board("over", [...smallPool, entry("qb-neg")])], { pool: smallPool })).toEqual([]);
    expect(codes(evaluate(allContests({ QB: contest("QB", { maxCalls: 5 }) })))).toEqual([["COMPETITION", "CONTEST_RULES_MISMATCH", "QB"]]);
    const noContests = evaluate((["QB", "RB", "WR", "TE", "DEF"] as const).map((position) => ({ position, kind: "NO_CONTEST" as const, currentSnapshot: { id: "snapshot-2", eligibleAtPosition: 0 } })));
    expect([noContests.status, codes(noContests)]).toEqual(["INTAKE_BLOCKED", [["COMPETITION", "NO_CONTEST_TO_GRADE", null]]]);
  });
});

describe("results intake authority", () => {
  it("carries no grade, run, approval or authority output: ready is a review status only", () => {
    const intake = evaluate();
    expect(Object.keys(intake).sort()).toEqual(
      ["acknowledgmentsRequired", "advisories", "artifact", "decisionsRequired", "decisionsResolved", "facts", "intakeFingerprint", "issues", "positions", "status", "version", "week"].sort(),
    );
    expect(JSON.stringify(intake)).not.toMatch(/"(?:run|boardGrades|callGrades|eyeqHundredths|awardedHonor|approvalId|gradeRunId|outputFingerprint)"\s*:/);
    expect(intake.acknowledgmentsRequired[0].detail).toMatch(/a separate grading approval is still required/);
  });
});
