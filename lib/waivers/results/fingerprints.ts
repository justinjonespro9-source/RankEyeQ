import { canonicalExportChecksum } from "@/lib/waivers/canonical/serialization";
import { WAIVER_POSITIONS, type WaiverPosition } from "@/lib/waivers/constants";

/**
 * Deterministic fingerprints for Waiver results and grading storage
 * (specification: docs/waivers-grading-fingerprints.md).
 *
 * Every fingerprint is canonicalExportChecksum (sng-canonical-json/1: sorted
 * object keys, arrays in the given order, safe integers, explicit nulls) of
 * `{ v, kind, ...payload }`. Collections are sorted here by code unit before
 * hashing, so callers' iteration order never matters. Generated row ids and
 * timestamps never enter a fingerprint; immutable competitive identities
 * (frozen snapshot entries, submissions, revisions, calls, RankEyeQ players,
 * SNG ids and checksums) do.
 */
export const WAIVER_GRADING_FINGERPRINT_VERSION = "rankeyeq-waiver-grading-fp/1";

type Payload = Record<string, unknown>;
const fp = (kind: string, payload: Payload) => canonicalExportChecksum({ v: WAIVER_GRADING_FINGERPRINT_VERSION, kind, ...payload });
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortedBy = <T>(items: readonly T[], key: (item: T) => string): T[] => [...items].sort((a, b) => byCodeUnit(key(a), key(b)));
const positionOrder = (position: WaiverPosition) => WAIVER_POSITIONS.indexOf(position);

function assertFivePositions<T extends { position: WaiverPosition }>(items: readonly T[], what: string): T[] {
  const sorted = [...items].sort((a, b) => positionOrder(a.position) - positionOrder(b.position));
  if (sorted.length !== WAIVER_POSITIONS.length || sorted.some((item, i) => item.position !== WAIVER_POSITIONS[i])) {
    throw new RangeError(`${what} must cover each of the five Waiver positions exactly once`);
  }
  return sorted;
}

// ---------------------------------------------------------------------------
// Sources: artifact and frozen snapshot identity
// ---------------------------------------------------------------------------

export type ArtifactIdentityInput = { seriesKey: string; revision: number; artifactId: string; contentChecksum: string };

export const artifactIdentityFingerprint = (a: ArtifactIdentityInput) =>
  fp("artifact-identity", { seriesKey: a.seriesKey, revision: a.revision, artifactId: a.artifactId, contentChecksum: a.contentChecksum });

export type SnapshotIdentityInput = { season: number; weekNumber: number; version: number; entriesFingerprint: string };

export const snapshotIdentityFingerprint = (s: SnapshotIdentityInput) =>
  fp("snapshot-identity", { season: s.season, weekNumber: s.weekNumber, version: s.version, entriesFingerprint: s.entriesFingerprint });

/**
 * The pinned snapshot of each of the week's five positions, in Waiver position
 * order (an empty position cites the frozen snapshot that has no eligible
 * candidate there).
 */
export const snapshotSetFingerprint = (pins: ReadonlyArray<{ position: WaiverPosition; snapshotFingerprint: string }>) =>
  fp("snapshot-set", { pins: assertFivePositions(pins, "snapshot set").map((p) => ({ position: p.position, snapshot: p.snapshotFingerprint })) });

// ---------------------------------------------------------------------------
// D3 resolutions
// ---------------------------------------------------------------------------

export type ConflictResolutionInput = {
  artifactFingerprint: string;
  position: WaiverPosition;
  conflictKey: string;
  conflictKind: "BYE_VS_SCHEDULED" | "TEAM_CHANGED";
  snapshotEntryId: string;
  sngParticipantId: string;
};

/** The conflict a resolution decides (stored as WaiverConflictResolution.inputFingerprint). */
export const conflictResolutionInputFingerprint = (r: ConflictResolutionInput) =>
  fp("conflict-resolution-input", {
    artifact: r.artifactFingerprint,
    position: r.position,
    conflictKey: r.conflictKey,
    conflictKind: r.conflictKind,
    snapshotEntryId: r.snapshotEntryId,
    sngParticipantId: r.sngParticipantId,
  });

export type AppliedResolution = {
  conflictKey: string;
  sequence: number;
  conflictKind: "BYE_VS_SCHEDULED" | "TEAM_CHANGED";
  resolution: "SCORE_AS_RANKED" | "NON_PARTICIPANT_ZERO" | "NEUTRALIZED";
};

/** The current resolutions applied, keyed by conflictKey and sequence (no resolver, reason or timestamp). */
export function resolutionSetFingerprint(resolutions: readonly AppliedResolution[]): string {
  const keys = resolutions.map((r) => r.conflictKey);
  if (new Set(keys).size !== keys.length) throw new RangeError("a resolution set holds at most one current resolution per conflict");
  return fp("resolution-set", {
    resolutions: sortedBy(resolutions, (r) => r.conflictKey).map((r) => ({
      conflictKey: r.conflictKey,
      sequence: r.sequence,
      conflictKind: r.conflictKind,
      resolution: r.resolution,
    })),
  });
}

// ---------------------------------------------------------------------------
// Contest results
// ---------------------------------------------------------------------------

export type SourceParticipantFact = {
  participantId: string;
  participationState: string;
  participantDisposition: string;
  pointsHundredths: number | null;
  competitionRank: number | null;
  resultFingerprint: string | null;
};

/** The SNG facts a contest result interprets, for one position. */
export const contestSourceFingerprint = (input: {
  artifactFingerprint: string;
  position: WaiverPosition;
  sngResultSetChecksum: string;
  participants: readonly SourceParticipantFact[];
}) =>
  fp("contest-source", {
    artifact: input.artifactFingerprint,
    position: input.position,
    sngResultSetChecksum: input.sngResultSetChecksum,
    participants: sortedBy(input.participants, (p) => p.participantId).map((p) => ({ ...p })),
  });

export type PoolRowFingerprintInput = {
  category: "ELIGIBLE_POOL_MEMBER" | "INVALIDATED_CALLED_PLAYER";
  snapshotEntryId: string | null;
  rankableEntryId: string;
  position: WaiverPosition;
  identityProvider: string;
  identityExternalId: string;
  sngParticipantId: string;
  participationState: string;
  participantDisposition: string;
  canonicalClass: "RANKED" | "NON_PARTICIPANT" | "SYSTEMIC_NEUTRALIZE" | "SNAPSHOT_CONFLICT";
  canonicalPointsHundredths: number | null;
  canonicalPositionRank: number | null;
  sngResultFingerprint: string | null;
  treatment: "RANKED" | "NON_PARTICIPANT_ZERO" | "NEUTRALIZED" | "INVALIDATED_PRE_LOCK";
  fpHundredths: number | null;
  waiverPoolRank: number | null;
  neutralizationPrecedence: "D2_NEUTRALIZATION_OVER_C2_INVALIDATION" | "D3_NEUTRALIZATION_OVER_C2_INVALIDATION" | null;
  /** The applied resolution by conflict key and sequence (never its row id). */
  resolution: { conflictKey: string; sequence: number } | null;
  invalidationBasis: "NOT_ELIGIBLE_IN_PINNED_SNAPSHOT" | "ABSENT_FROM_PINNED_SNAPSHOT" | null;
};

export const poolRowFingerprint = (row: PoolRowFingerprintInput) => fp("pool-row", { ...row, resolution: row.resolution ? { ...row.resolution } : null });

const poolRowSortKey = (row: { category: string; rankableEntryId: string }) => `${row.category}\u0000${row.rankableEntryId}`;

/** WaiverContestResult.resultFingerprint: the interpreted result content. */
export const contestResultFingerprint = (input: {
  position: WaiverPosition;
  resultFieldSize: number;
  eligiblePoolSize: number;
  effectivePoolSize: number;
  effectiveFieldSize: number;
  effectiveAvailableSlots: number;
  invalidatedCalledCount: number;
  rows: ReadonlyArray<{ category: string; rankableEntryId: string; rowFingerprint: string }>;
}) =>
  fp("contest-result", {
    position: input.position,
    resultFieldSize: input.resultFieldSize,
    eligiblePoolSize: input.eligiblePoolSize,
    effectivePoolSize: input.effectivePoolSize,
    effectiveFieldSize: input.effectiveFieldSize,
    effectiveAvailableSlots: input.effectiveAvailableSlots,
    invalidatedCalledCount: input.invalidatedCalledCount,
    rows: sortedBy(input.rows, poolRowSortKey).map((r) => r.rowFingerprint),
  });

/** WaiverContestResult.inputFingerprint: everything the result was derived from (idempotency key per contest). */
export const contestResultInputFingerprint = (input: {
  resultsPolicyVersion: string;
  position: WaiverPosition;
  artifactFingerprint: string;
  snapshotFingerprint: string;
  sourceFingerprint: string;
  resolutionSetFingerprint: string;
  /** Players called on locked boards (decides the invalidated category). */
  calledRankableEntryIds: readonly string[];
}) =>
  fp("contest-result-input", {
    resultsPolicyVersion: input.resultsPolicyVersion,
    position: input.position,
    artifact: input.artifactFingerprint,
    snapshot: input.snapshotFingerprint,
    source: input.sourceFingerprint,
    resolutionSet: input.resolutionSetFingerprint,
    calledRankableEntryIds: [...new Set(input.calledRankableEntryIds)].sort(byCodeUnit),
  });

/** WaiverEmptyPositionResult.resultFingerprint: a position with no eligible candidate (no contest, pool or grades). */
export const emptyPositionResultFingerprint = (input: { resultsPolicyVersion: string; position: WaiverPosition; snapshotFingerprint: string }) =>
  fp("empty-position-result", {
    resultsPolicyVersion: input.resultsPolicyVersion,
    position: input.position,
    snapshot: input.snapshotFingerprint,
    eligiblePoolSize: 0,
  });

// ---------------------------------------------------------------------------
// Call and board grades
// ---------------------------------------------------------------------------

export const callGradeInputFingerprint = (input: {
  slot: number;
  callId: string;
  snapshotEntryId: string;
  rankableEntryId: string;
  poolRowFingerprint: string;
  resultFieldSize: number;
}) => fp("call-grade-input", { ...input });

export type CallGradeOutput = {
  slot: number;
  treatment: PoolRowFingerprintInput["treatment"];
  scored: boolean;
  waiverPoolRank: number | null;
  canonicalPositionRank: number | null;
  fpHundredths: number | null;
  inResultField: boolean;
  exact: boolean;
  earnedRawPoints: number | null;
  maxRawPoints: number | null;
  honorCreditEligible: boolean;
  invalidatedPreLock: boolean;
  neutralizationPrecedence: PoolRowFingerprintInput["neutralizationPrecedence"];
};

export const callGradeOutputFingerprint = (output: CallGradeOutput) => fp("call-grade-output", { ...output });

const bySlot = <T extends { slot: number }>(calls: readonly T[]): T[] => {
  const sorted = [...calls].sort((a, b) => a.slot - b.slot);
  sorted.forEach((call, i) => {
    if (call.slot !== i + 1) throw new RangeError("board calls must occupy contiguous slots from 1");
  });
  return sorted;
};

export const boardGradeInputFingerprint = (input: {
  submissionId: string;
  revisionId: string;
  revisionFingerprint: string;
  position: WaiverPosition;
  contestResultFingerprint: string;
  availableSlots: number;
  calls: ReadonlyArray<{ slot: number; inputFingerprint: string }>;
}) =>
  fp("board-grade-input", {
    submissionId: input.submissionId,
    revisionId: input.revisionId,
    revisionFingerprint: input.revisionFingerprint,
    position: input.position,
    contestResult: input.contestResultFingerprint,
    availableSlots: input.availableSlots,
    calls: bySlot(input.calls).map((c) => c.inputFingerprint),
  });

export type BoardGradeOutput = {
  submittedCallCount: number;
  scoreableCallCount: number;
  neutralizedCallCount: number;
  invalidatedCallCount: number;
  exactCallCount: number;
  availableSlots: number;
  effectiveAvailableSlots: number;
  coverageCallCount: number;
  slotOverflow: boolean;
  earnedRawPoints: number;
  maxRawPoints: number;
  coverageModifierNumerator: number | null;
  coverageModifierDenominator: number | null;
  eyeqHundredths: number | null;
  totalFpHundredths: number;
  fpPerCallHundredths: number | null;
  fpPerAvailableSlotHundredths: number | null;
  resultKind: "SCORED" | "NA_ZERO_CALL" | "NA_ALL_NEUTRALIZED" | "NA_NO_EFFECTIVE_SLOTS";
  ungradableReason: "CORRECTED_POOL_EMPTY" | "NEUTRALIZATIONS_CONSUMED_SLOTS" | null;
  played: boolean;
  honorEligible: boolean;
  honorIneligibleReason: string | null;
  awardedHonor: "PERFECT_CALL" | "PERFECT_PODIUM" | "PERFECT_FIVE" | null;
};

export const boardGradeOutputFingerprint = (output: BoardGradeOutput, calls: ReadonlyArray<{ slot: number; outputFingerprint: string }>) =>
  fp("board-grade-output", { ...output, calls: bySlot(calls).map((c) => c.outputFingerprint) });

// ---------------------------------------------------------------------------
// Grade runs and the complete week output
// ---------------------------------------------------------------------------

/** Each position is graded from its contest result or is explicitly empty (no eligible candidate). */
export type PositionedResult =
  | { position: WaiverPosition; kind: "CONTEST_RESULT"; inputFingerprint: string; resultFingerprint: string }
  | { position: WaiverPosition; kind: "EMPTY_ELIGIBLE_POOL"; inputFingerprint: null; resultFingerprint: string };

function positionedResults(results: readonly PositionedResult[], what: string) {
  const sorted = assertFivePositions(results, what);
  if (!sorted.some((r) => r.kind === "CONTEST_RESULT")) throw new RangeError(`${what} must include at least one contest result`);
  if (sorted.some((r) => (r.kind === "CONTEST_RESULT") !== (r.inputFingerprint !== null))) {
    throw new RangeError(`${what}: only contest results carry an input fingerprint`);
  }
  return sorted;
}

/** WaiverGradeRun.inputFingerprint: identical inputs replay to the same run (idempotency key per week). */
export const gradeRunInputFingerprint = (input: {
  gradingRulesetVersion: string;
  scoringVersion: string;
  season: number;
  weekNumber: number;
  artifactFingerprint: string;
  snapshotSetFingerprint: string;
  resolutionSetFingerprint: string;
  contestResults: readonly PositionedResult[];
  boards: ReadonlyArray<{ submissionId: string; inputFingerprint: string }>;
}) =>
  fp("grade-run-input", {
    gradingRulesetVersion: input.gradingRulesetVersion,
    scoringVersion: input.scoringVersion,
    season: input.season,
    weekNumber: input.weekNumber,
    artifact: input.artifactFingerprint,
    snapshotSet: input.snapshotSetFingerprint,
    resolutionSet: input.resolutionSetFingerprint,
    contestResults: positionedResults(input.contestResults, "grade run results").map((r) => ({
      position: r.position,
      kind: r.kind,
      input: r.inputFingerprint,
      result: r.resultFingerprint,
    })),
    boards: sortedBy(input.boards, (b) => b.submissionId).map((b) => ({ submissionId: b.submissionId, input: b.inputFingerprint })),
  });

/** WaiverGradeRun.outputFingerprint: the complete week grade output that an approval binds. */
export const weekGradeOutputFingerprint = (input: {
  gradeRunInputFingerprint: string;
  contestResults: readonly PositionedResult[];
  boards: ReadonlyArray<{ submissionId: string; outputFingerprint: string }>;
}) =>
  fp("week-grade-output", {
    input: input.gradeRunInputFingerprint,
    contestResults: positionedResults(input.contestResults, "week output results").map((r) => ({
      position: r.position,
      kind: r.kind,
      result: r.resultFingerprint,
    })),
    boards: sortedBy(input.boards, (b) => b.submissionId).map((b) => ({ submissionId: b.submissionId, output: b.outputFingerprint })),
  });
