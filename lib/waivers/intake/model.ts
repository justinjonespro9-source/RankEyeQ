import { WAIVER_ARTIFACT_AUTHORITY_LABEL } from "@/lib/waivers/artifacts/authority";
import type { VerifiedSngCanonicalArtifact } from "@/lib/waivers/canonical/artifact-verifier";
import { collectWaiverContestMembers, waiverContestMemberConflicts, waiverMemberIdentity } from "@/lib/waivers/canonical/contest-members";
import { classifyCanonicalParticipation, type WaiverCanonicalClass } from "@/lib/waivers/canonical/disposition";
import { indexCanonicalLedger } from "@/lib/waivers/canonical/identity";
import type { SnapshotCanonicalConflictKind } from "@/lib/waivers/canonical/policy";
import { evaluateCanonicalPreflightEntry, type PreflightSnapshotEntry } from "@/lib/waivers/canonical/preflight-model";
import { canonicalExportChecksum } from "@/lib/waivers/canonical/serialization";
import { RANKEYEQ_SNG_TEAM_CROSSWALK_STATUS, RANKEYEQ_SNG_TEAM_CROSSWALK_VERSION } from "@/lib/waivers/canonical/team-crosswalk";
import { WAIVER_EYEQ_V1, WAIVER_MAX_CALLS, WAIVER_POSITIONS, WAIVER_RESULT_FIELD_SIZE, type WaiverPosition } from "@/lib/waivers/constants";

/**
 * Results intake review: an imported canonical artifact reconciled against the
 * week's competition before any grade exists. It checks that the artifact is
 * the week's gradable revision, that every frozen pool member and every player
 * called on a locked board maps to exactly one canonical result, and which
 * snapshot conflicts still need an explicit operator D3 decision. Pure: it
 * reports, it never grades, resolves, approves or writes.
 */

export const WAIVER_RESULTS_INTAKE_VERSION = "rankeyeq-waiver-results-intake/1";

export type WaiverIntakeStatus = "ARTIFACT_NOT_GRADABLE" | "INTAKE_BLOCKED" | "D3_DECISIONS_REQUIRED" | "READY_FOR_GRADING_PREVIEW";

export type WaiverIntakeStage = "ARTIFACT" | "COMPETITION" | "RECONCILIATION";

export type WaiverIntakeIssue = { stage: WaiverIntakeStage; code: string; detail: string; position?: WaiverPosition; snapshotEntryId?: string; submissionId?: string };

export type WaiverIntakeNotice = { code: string; detail: string; position?: WaiverPosition };

export type WaiverIntakeArtifactInput = {
  rowId: string;
  artifactId: string;
  seriesKey: string;
  revision: number;
  contentChecksum: string;
  weekId: string;
  defCrosswalkVersion: string;
  latestState: string | null;
  latestSequence: number | null;
  /** Later revisions of the same series imported for this week. */
  newerRevisions: number;
  verification: { ok: true; verified: VerifiedSngCanonicalArtifact } | { ok: false; issueCodes: string[] };
};

export type WaiverIntakeResolution = {
  id: string;
  conflictKey: string;
  sequence: number;
  conflictKind: string;
  resolution: string;
  snapshotEntryId: string;
  sngParticipantId: string;
};

/** One locked board, whatever its competitor's type or current activity. */
export type WaiverIntakeBoardInput = {
  submissionId: string;
  revisionId: string;
  revisionFingerprint: string;
  revisionKind: string;
  revisionCallCount: number;
  competitor: { universalProfileId: string; profileType: string; competitorActive: boolean; entryBasis: "STANDARD" | "AI_LATE_ENTRY" | "ADMIN_COMPETITIVE_OVERRIDE" };
  calls: ReadonlyArray<{ slot: number; entry: PreflightSnapshotEntry }>;
};

export type WaiverIntakePositionInput =
  | {
      position: WaiverPosition;
      kind: "CONTEST";
      contest: { id: string; status: string; snapshotId: string; scoringVersion: string; maxCalls: number; resultFieldSize: number };
      snapshot: { id: string; version: number; entriesFingerprint: string; isCurrent: boolean; entries: readonly PreflightSnapshotEntry[] };
      /** Every locked board of the contest. */
      boards: readonly WaiverIntakeBoardInput[];
      unstampedBoardCount: number;
      /** Current (unsuperseded) D3 resolutions of this contest bound to the reviewed artifact row. */
      resolutions: readonly WaiverIntakeResolution[];
    }
  | { position: WaiverPosition; kind: "NO_CONTEST"; currentSnapshot: { id: string; eligibleAtPosition: number } | null };

export type WaiverIntakeMemberRow = {
  category: "ELIGIBLE_POOL_MEMBER" | "INVALIDATED_CALLED_PLAYER";
  snapshotEntryId: string;
  rankableEntryId: string;
  /** Diagnostic only; never used for matching. */
  displayName: string;
  identity: { provider: string; externalId: string };
  identitySource: "FROZEN_AT_SNAPSHOT" | "LIVE_NOT_FROZEN";
  sngParticipantId: string | null;
  sngPosition: string | null;
  participationState: string | null;
  disposition: string | null;
  cls: WaiverCanonicalClass | null;
  pointsHundredths: number | null;
  canonicalRank: number | null;
  positionMismatch: boolean;
  issueCodes: string[];
};

export type WaiverIntakeConflictStatus = "RESOLVED" | "DECISION_REQUIRED" | "RESOLUTION_MISMATCH";

export type WaiverIntakeConflict = {
  conflictKey: string;
  kind: SnapshotCanonicalConflictKind;
  snapshotEntryId: string;
  sngParticipantId: string;
  rankableEntryId: string;
  displayName: string;
  category: WaiverIntakeMemberRow["category"];
  detail: string;
  status: WaiverIntakeConflictStatus;
  resolution: { id: string; sequence: number; treatment: string } | null;
};

export type WaiverIntakePosition = {
  position: WaiverPosition;
  kind: "CONTEST" | "EMPTY_ELIGIBLE_POOL" | "BLOCKED";
  contestId: string | null;
  contestStatus: string | null;
  snapshotId: string | null;
  snapshotIsCurrent: boolean | null;
  lockedBoardCount: number;
  lockedBoards: WaiverIntakeBoardCounts;
  eligiblePoolSize: number;
  invalidatedCalledCount: number;
  matchedCount: number;
  artifactFieldSize: number | null;
  byClass: Partial<Record<WaiverCanonicalClass, number>>;
  positionMismatchCount: number;
  rows: WaiverIntakeMemberRow[];
  conflicts: WaiverIntakeConflict[];
};

export type WaiverIntakeBoardCounts = { human: number; nonHuman: number; adminOverride: number; aiLateEntry: number; inactiveNonHuman: number };

const NO_BOARDS: WaiverIntakeBoardCounts = { human: 0, nonHuman: 0, adminOverride: 0, aiLateEntry: 0, inactiveNonHuman: 0 };

export type WaiverIntakeFacts = {
  participantCount: number;
  fieldSizes: Record<WaiverPosition, number | null>;
  ledgerByClass: Partial<Record<WaiverCanonicalClass, number>>;
  eventsByDisposition: Record<string, number>;
};

export type WaiverResultsIntake = {
  version: typeof WAIVER_RESULTS_INTAKE_VERSION;
  week: { id: string; season: number; weekNumber: number };
  artifact: {
    rowId: string;
    artifactId: string;
    seriesKey: string;
    revision: number;
    contentChecksum: string;
    latestState: string | null;
    latestSequence: number | null;
    contentVerified: boolean;
    gradable: boolean;
  };
  facts: WaiverIntakeFacts | null;
  status: WaiverIntakeStatus;
  positions: WaiverIntakePosition[];
  issues: WaiverIntakeIssue[];
  decisionsRequired: number;
  decisionsResolved: number;
  /** What a later grading approval must explicitly acknowledge; intake records none of them. */
  acknowledgmentsRequired: WaiverIntakeNotice[];
  advisories: WaiverIntakeNotice[];
  intakeFingerprint: string;
};

const countBy = <T extends string>(values: readonly T[]) => {
  const out: Partial<Record<T, number>> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
};

function artifactFacts(verified: VerifiedSngCanonicalArtifact): WaiverIntakeFacts {
  const payload = verified.artifact.payload;
  const fieldSizes = Object.fromEntries(
    WAIVER_POSITIONS.map((position) => [position, payload.resultSets.find((set) => set.positionCode === position)?.fieldSize ?? null]),
  ) as Record<WaiverPosition, number | null>;
  const eventsByDisposition: Record<string, number> = {};
  for (const event of payload.coverage.manifest.events) eventsByDisposition[event.disposition] = (eventsByDisposition[event.disposition] ?? 0) + 1;
  return {
    participantCount: payload.participationLedger.length,
    fieldSizes,
    ledgerByClass: countBy(payload.participationLedger.map((row) => classifyCanonicalParticipation(row.state, row.disposition).cls)),
    eventsByDisposition,
  };
}

function evaluateContestPosition(
  input: Extract<WaiverIntakePositionInput, { kind: "CONTEST" }>,
  verified: VerifiedSngCanonicalArtifact | null,
  issues: WaiverIntakeIssue[],
  advisories: WaiverIntakeNotice[],
): WaiverIntakePosition {
  const { position, contest, snapshot, boards } = input;
  const issue = (stage: WaiverIntakeStage, code: string, detail: string, snapshotEntryId?: string) =>
    issues.push({ stage, code, detail, position, ...(snapshotEntryId ? { snapshotEntryId } : {}) });
  const boardIssue = (submissionId: string, code: string, detail: string) => issues.push({ stage: "COMPETITION", code, detail, position, submissionId });

  if (contest.status !== "LOCKED") issue("COMPETITION", "CONTEST_NOT_LOCKED", `${position} contest is ${contest.status}`);
  if (contest.scoringVersion !== WAIVER_EYEQ_V1.slug || contest.maxCalls !== WAIVER_MAX_CALLS[position] || contest.resultFieldSize !== WAIVER_RESULT_FIELD_SIZE[position]) {
    issue("COMPETITION", "CONTEST_RULES_MISMATCH", `${position} contest rules are not ${WAIVER_EYEQ_V1.slug} with ${WAIVER_MAX_CALLS[position]} calls`);
  }
  if (input.unstampedBoardCount > 0) issue("COMPETITION", "SUBMISSION_NOT_LOCK_STAMPED", `${input.unstampedBoardCount} submitted ${position} board(s) lack their lock stamp`);
  if (!snapshot.isCurrent) {
    advisories.push({ code: "CONTEST_SNAPSHOT_NOT_CURRENT", detail: `${position} is pinned to snapshot ${snapshot.id}, not the week's current snapshot`, position });
  }

  const calledEntries = boards.flatMap((board) => board.calls.map((call) => call.entry));
  const { eligible, members, ambiguous } = collectWaiverContestMembers({ position, snapshotEntries: snapshot.entries, calledEntries });
  for (const a of ambiguous) {
    issue("RECONCILIATION", "CALLED_IDENTITY_AMBIGUOUS", `called player ${a.rankableEntryId} carries ${a.identityCount} different frozen identities`, a.snapshotEntryId);
  }

  // The engine's board checks, which depend only on the frozen pool and the locked calls.
  const eligiblePlayers = new Set(eligible.map((entry) => entry.rankableEntryId));
  const memberPlayers = new Set(members.map((member) => member.entry.rankableEntryId));
  const availableSlots = Math.min(contest.maxCalls, eligible.length);
  const lockedBoards = { ...NO_BOARDS };
  for (const board of boards) {
    const { competitor } = board;
    if (competitor.profileType === "HUMAN") lockedBoards.human++;
    else lockedBoards.nonHuman++;
    if (competitor.entryBasis === "ADMIN_COMPETITIVE_OVERRIDE") lockedBoards.adminOverride++;
    if (competitor.entryBasis === "AI_LATE_ENTRY") lockedBoards.aiLateEntry++;
    if (competitor.profileType !== "HUMAN" && !competitor.competitorActive) {
      lockedBoards.inactiveNonHuman++;
      advisories.push({
        code: "INACTIVE_COMPETITOR_LOCKED_BOARD",
        detail: `locked ${position} board ${board.submissionId} belongs to inactive ${competitor.profileType} profile ${competitor.universalProfileId}; it is reviewed and graded like any other`,
        position,
      });
    }
    if (board.revisionKind !== "SUBMISSION" || board.revisionCallCount !== board.calls.length) {
      boardIssue(board.submissionId, "BOARD_REVISION_INVALID", `locked revision must be a SUBMISSION holding its ${board.revisionCallCount} calls`);
    }
    const sorted = [...board.calls].sort((a, b) => a.slot - b.slot);
    if (sorted.some((call, i) => call.slot !== i + 1)) boardIssue(board.submissionId, "BOARD_SLOTS_NOT_CONTIGUOUS", "board calls must occupy contiguous slots from 1");
    if (sorted.length > contest.resultFieldSize) boardIssue(board.submissionId, "BOARD_CALLS_EXCEED_SLOTS", `${sorted.length} calls exceed the ${contest.resultFieldSize}-slot board`);
    const missing = sorted.filter((call) => !memberPlayers.has(call.entry.rankableEntryId));
    for (const call of missing) boardIssue(board.submissionId, "BOARD_CALL_WITHOUT_POOL_ROW", `slot ${call.slot} player ${call.entry.rankableEntryId} has no contest row`);
    const eligibleCalls = sorted.filter((call) => eligiblePlayers.has(call.entry.rankableEntryId)).length;
    if (eligibleCalls > availableSlots) boardIssue(board.submissionId, "BOARD_CALLS_EXCEED_SLOTS", `${eligibleCalls} eligible calls exceed the ${availableSlots} available slots`);
  }

  const base: WaiverIntakePosition = {
    position,
    kind: "CONTEST",
    contestId: contest.id,
    contestStatus: contest.status,
    snapshotId: snapshot.id,
    snapshotIsCurrent: snapshot.isCurrent,
    lockedBoardCount: boards.length,
    lockedBoards,
    eligiblePoolSize: eligible.length,
    invalidatedCalledCount: members.filter((m) => m.category === "INVALIDATED_CALLED_PLAYER").length,
    matchedCount: 0,
    artifactFieldSize: null,
    byClass: {},
    positionMismatchCount: 0,
    rows: [],
    conflicts: [],
  };
  if (!verified) return base;

  const index = indexCanonicalLedger(verified.artifact);
  const resultSets = new Map(verified.artifact.payload.resultSets.map((set) => [set.positionCode as string, set]));
  const contestSet = resultSets.get(position);
  if (!contestSet) issue("RECONCILIATION", "RESULT_SET_MISSING", `artifact has no ${position} result set`);
  base.artifactFieldSize = contestSet?.fieldSize ?? null;

  const evaluated = members.map((member) => ({ member, row: evaluateCanonicalPreflightEntry(member.entry, index, verified) }));
  const byParticipant = new Map<string, string[]>();
  for (const { member, row } of evaluated) {
    for (const found of row.issues) if (found.code !== "SNAPSHOT_CANONICAL_CONFLICT") issue("RECONCILIATION", found.code, found.detail, found.snapshotEntryId);
    if (row.canonical) byParticipant.set(row.canonical.participantId, [...(byParticipant.get(row.canonical.participantId) ?? []), member.entry.snapshotEntryId]);
  }
  for (const [participantId, entries] of byParticipant) {
    if (entries.length > 1) issue("RECONCILIATION", "DUPLICATE_POOL_MATCH", `${entries.length} contest rows match canonical participant ${participantId}`, entries[0]);
  }

  const resolutionsByKey = new Map(input.resolutions.map((r) => [r.conflictKey, r]));
  const appliedKeys = new Set<string>();
  for (const { member, row } of evaluated) {
    const canonical = row.canonical;
    const rowIssueCodes = row.issues.filter((i) => i.code !== "SNAPSHOT_CANONICAL_CONFLICT").map((i) => i.code);
    const identity = waiverMemberIdentity(member.entry);
    base.rows.push({
      category: member.category,
      snapshotEntryId: member.entry.snapshotEntryId,
      rankableEntryId: member.entry.rankableEntryId,
      displayName: member.entry.displayNameAtFreeze,
      identity: { provider: identity.provider, externalId: identity.externalId },
      identitySource: row.identitySource,
      sngParticipantId: canonical?.participantId ?? null,
      sngPosition: canonical?.sngPosition ?? null,
      participationState: canonical?.state ?? null,
      disposition: canonical?.disposition ?? null,
      cls: canonical?.cls ?? null,
      pointsHundredths: canonical?.cls === "RANKED" ? canonical.pointsHundredths : null,
      canonicalRank: canonical?.cls === "RANKED" ? canonical.overallPositionRank : null,
      positionMismatch: row.positionMismatch,
      issueCodes: rowIssueCodes,
    });
    if (!canonical || canonical.cls === "BLOCKED") continue;
    const at = member.entry.snapshotEntryId;

    if (canonical.cls === "RANKED") {
      const entry = resultSets.get(canonical.sngPosition)?.entries.find((e) => e.participantId === canonical.participantId);
      if (!entry) {
        issue("RECONCILIATION", "RESULT_ENTRY_MISSING", `${row.displayNameAtFreeze}: ranked participant ${canonical.participantId} has no ${canonical.sngPosition} result entry`, at);
        continue;
      }
      if (entry.pointsHundredths !== canonical.pointsHundredths || entry.competitionRank !== canonical.overallPositionRank) {
        issue("RECONCILIATION", "RESULT_ENTRY_MISMATCH", `${row.displayNameAtFreeze}: ledger and result entry disagree on points or rank`, at);
        continue;
      }
    }

    const conflicts = waiverContestMemberConflicts(member, row, verified.summary.contentChecksum);
    if (conflicts === "AMBIGUOUS") {
      issue("RECONCILIATION", "AMBIGUOUS_BYE_CONFLICT", `${row.displayNameAtFreeze}: canonical BYE against more than one originally called scheduled entry`, at);
      continue;
    }
    if (canonical.cls === "SNAPSHOT_CONFLICT" && conflicts.length === 0) {
      issue("RECONCILIATION", "UNRESOLVABLE_BYE", `${row.displayNameAtFreeze}: canonical BYE has no resolvable snapshot conflict`, at);
      continue;
    }
    const applied: WaiverIntakeResolution[] = [];
    for (const conflict of conflicts) {
      const resolution = resolutionsByKey.get(conflict.conflictKey) ?? null;
      const matches =
        resolution !== null &&
        resolution.conflictKind === conflict.kind &&
        resolution.snapshotEntryId === conflict.snapshotEntryId &&
        resolution.sngParticipantId === canonical.participantId;
      base.conflicts.push({
        conflictKey: conflict.conflictKey,
        kind: conflict.kind,
        snapshotEntryId: conflict.snapshotEntryId,
        sngParticipantId: canonical.participantId,
        rankableEntryId: member.entry.rankableEntryId,
        displayName: member.entry.displayNameAtFreeze,
        category: member.category,
        detail: conflict.detail,
        status: matches ? "RESOLVED" : resolution ? "RESOLUTION_MISMATCH" : "DECISION_REQUIRED",
        resolution: resolution ? { id: resolution.id, sequence: resolution.sequence, treatment: resolution.resolution } : null,
      });
      if (matches) {
        applied.push(resolution);
        appliedKeys.add(resolution.conflictKey);
      }
    }
    if (applied.length !== conflicts.length) continue;
    if (applied.length > 1) {
      issue("RECONCILIATION", "CONFLICT_RESOLUTION_NOT_APPLICABLE", `${row.displayNameAtFreeze}: a pool row applies at most one D3 resolution`, at);
    } else if (applied[0]?.resolution === "SCORE_AS_RANKED" && canonical.cls !== "RANKED") {
      issue("RECONCILIATION", "CONFLICT_RESOLUTION_NOT_APPLICABLE", `${row.displayNameAtFreeze}: SCORE_AS_RANKED requires a ranked canonical result`, at);
    }
  }
  for (const resolution of input.resolutions) {
    if (!appliedKeys.has(resolution.conflictKey)) {
      issue("RECONCILIATION", "UNAPPLIED_CONFLICT_RESOLUTION", `current D3 resolution ${resolution.conflictKey} matches no conflict of this contest`, resolution.snapshotEntryId);
    }
  }

  base.matchedCount = base.rows.filter((r) => r.sngParticipantId !== null && r.issueCodes.length === 0).length;
  base.byClass = countBy(base.rows.flatMap((r) => (r.cls ? [r.cls] : [])));
  base.positionMismatchCount = base.rows.filter((r) => r.positionMismatch).length;
  if (base.positionMismatchCount > 0) {
    advisories.push({ code: "CANONICAL_POSITION_DIFFERS", detail: `${base.positionMismatchCount} ${position} row(s) carry a different SNG position (evidence only)`, position });
  }
  return base;
}

export function evaluateWaiverResultsIntake(input: {
  week: { id: string; season: number; weekNumber: number };
  artifact: WaiverIntakeArtifactInput;
  positions: readonly WaiverIntakePositionInput[];
}): WaiverResultsIntake {
  const { week, artifact } = input;
  const issues: WaiverIntakeIssue[] = [];
  const advisories: WaiverIntakeNotice[] = [];
  const gate = (code: string, detail: string) => issues.push({ stage: "ARTIFACT", code, detail });

  // D5: only the week's latest, ACCEPTED, intact revision is gradable.
  if (artifact.weekId !== week.id) gate("ARTIFACT_WEEK_MISMATCH", "the artifact belongs to another week");
  if (artifact.latestState !== "ACCEPTED") gate("ARTIFACT_NOT_ACCEPTED", `artifact publication state is ${artifact.latestState ?? "unknown"}`);
  if (artifact.newerRevisions > 0) gate("ARTIFACT_NOT_LATEST", `${artifact.newerRevisions} later revision(s) of the series are imported`);
  if (artifact.defCrosswalkVersion !== RANKEYEQ_SNG_TEAM_CROSSWALK_VERSION) {
    gate("DEF_CROSSWALK_VERSION_MISMATCH", `artifact imported under ${artifact.defCrosswalkVersion}; current crosswalk is ${RANKEYEQ_SNG_TEAM_CROSSWALK_VERSION}`);
  }
  const verified = artifact.verification.ok ? artifact.verification.verified : null;
  if (!artifact.verification.ok) gate("ARTIFACT_CONTENT_INVALID", artifact.verification.issueCodes.join(", ") || "artifact content is missing");
  if (verified && (verified.summary.season !== week.season || verified.summary.week !== week.weekNumber)) {
    gate("ARTIFACT_WEEK_MISMATCH", `artifact covers ${verified.summary.season} week ${verified.summary.week}`);
  }
  if (verified && verified.summary.contentChecksum !== artifact.contentChecksum) {
    gate("ARTIFACT_CONTENT_INVALID", "verified artifact content does not match the artifact row checksum");
  }
  const artifactGateFailed = issues.length > 0;

  const positions: WaiverIntakePosition[] = [];
  for (const position of WAIVER_POSITIONS) {
    const entry = input.positions.find((p) => p.position === position);
    if (entry?.kind === "CONTEST") {
      positions.push(evaluateContestPosition(entry, verified, issues, advisories));
      continue;
    }
    const empty: WaiverIntakePosition = {
      position,
      kind: "BLOCKED",
      contestId: null,
      contestStatus: null,
      snapshotId: null,
      snapshotIsCurrent: null,
      lockedBoardCount: 0,
      lockedBoards: { ...NO_BOARDS },
      eligiblePoolSize: 0,
      invalidatedCalledCount: 0,
      matchedCount: 0,
      artifactFieldSize: verified?.artifact.payload.resultSets.find((set) => set.positionCode === position)?.fieldSize ?? null,
      byClass: {},
      positionMismatchCount: 0,
      rows: [],
      conflicts: [],
    };
    const current = entry?.kind === "NO_CONTEST" ? entry.currentSnapshot : null;
    if (!current) {
      issues.push({ stage: "COMPETITION", code: "CURRENT_SNAPSHOT_MISSING", detail: "the week has no current frozen snapshot", position });
    } else if (current.eligibleAtPosition > 0) {
      issues.push({ stage: "COMPETITION", code: "CONTEST_MISSING", detail: `${position} has ${current.eligibleAtPosition} eligible candidate(s) but no contest`, position });
      empty.snapshotId = current.id;
    } else {
      empty.kind = "EMPTY_ELIGIBLE_POOL";
      empty.snapshotId = current.id;
      empty.snapshotIsCurrent = true;
    }
    positions.push(empty);
  }
  if (!positions.some((p) => p.kind === "CONTEST")) {
    issues.push({ stage: "COMPETITION", code: "NO_CONTEST_TO_GRADE", detail: "the week has no Waiver contest, so there is nothing to grade" });
  }

  const conflicts = positions.flatMap((p) => p.conflicts);
  const decisionsRequired = conflicts.filter((c) => c.status !== "RESOLVED").length;
  const decisionsResolved = conflicts.length - decisionsRequired;
  const status: WaiverIntakeStatus = artifactGateFailed
    ? "ARTIFACT_NOT_GRADABLE"
    : issues.length > 0
      ? "INTAKE_BLOCKED"
      : decisionsRequired > 0
        ? "D3_DECISIONS_REQUIRED"
        : "READY_FOR_GRADING_PREVIEW";

  const acknowledgmentsRequired: WaiverIntakeNotice[] = [
    { code: "OPERATOR_ATTESTED_AUTHORITY", detail: `${WAIVER_ARTIFACT_AUTHORITY_LABEL}; a separate grading approval is still required` },
  ];
  if (RANKEYEQ_SNG_TEAM_CROSSWALK_STATUS === "SOURCE_DERIVED_PENDING_PRODUCER_FIXTURE" && positions.some((p) => p.position === "DEF" && p.kind === "CONTEST")) {
    acknowledgmentsRequired.push({
      code: "DEF_CROSSWALK_PENDING_PRODUCER_CONFIRMATION",
      detail: `DEF rows match through ${RANKEYEQ_SNG_TEAM_CROSSWALK_VERSION}, which no SNG-produced artifact has confirmed yet`,
      position: "DEF",
    });
  }
  const liveIdentityRows = positions.reduce((n, p) => n + p.rows.filter((r) => r.identitySource === "LIVE_NOT_FROZEN").length, 0);
  if (liveIdentityRows > 0) {
    acknowledgmentsRequired.push({
      code: "IDENTITY_KEY_NOT_FROZEN_AT_SNAPSHOT",
      detail: `${liveIdentityRows} row(s) were frozen before Stage 4B.1 and match on the live RankableEntry key; re-run the identity consistency evidence immediately before approval`,
    });
  }

  const intakeFingerprint = canonicalExportChecksum({
    v: WAIVER_RESULTS_INTAKE_VERSION,
    weekId: week.id,
    artifact: {
      rowId: artifact.rowId,
      contentChecksum: artifact.contentChecksum,
      latestState: artifact.latestState,
      latestSequence: artifact.latestSequence,
      newerRevisions: artifact.newerRevisions,
      defCrosswalkVersion: artifact.defCrosswalkVersion,
      contentVerified: verified !== null,
    },
    positions: WAIVER_POSITIONS.flatMap((position) => input.positions.filter((p) => p.position === position)).map((p) =>
      p.kind === "CONTEST"
        ? {
            position: p.position,
            contestId: p.contest.id,
            contestStatus: p.contest.status,
            rules: [p.contest.scoringVersion, p.contest.maxCalls, p.contest.resultFieldSize],
            snapshotId: p.snapshot.id,
            snapshotVersion: p.snapshot.version,
            entriesFingerprint: p.snapshot.entriesFingerprint,
            boards: [...p.boards]
              .sort((a, b) => (a.submissionId < b.submissionId ? -1 : a.submissionId > b.submissionId ? 1 : 0))
              .map((b) => [
                b.submissionId,
                b.revisionId,
                b.revisionFingerprint,
                b.competitor.profileType,
                b.competitor.competitorActive,
                b.competitor.entryBasis,
                b.calls.map((c) => [c.slot, c.entry.snapshotEntryId]),
              ]),
            unstampedBoardCount: p.unstampedBoardCount,
            resolutions: p.resolutions.map((r) => [r.id, r.conflictKey, r.sequence]),
          }
        : { position: p.position, currentSnapshot: p.currentSnapshot ? [p.currentSnapshot.id, p.currentSnapshot.eligibleAtPosition] : null },
    ),
    identity: positions.map((p) => p.rows.map((r) => [r.category, r.snapshotEntryId, r.identity.provider, r.identity.externalId, r.sngParticipantId, r.cls])),
    conflicts: conflicts.map((c) => [c.conflictKey, c.status, c.resolution?.id ?? null]),
    status,
    issues: issues.map((i) => [i.stage, i.code, i.position ?? null, i.snapshotEntryId ?? null, i.submissionId ?? null]),
  });

  return {
    version: WAIVER_RESULTS_INTAKE_VERSION,
    week,
    artifact: {
      rowId: artifact.rowId,
      artifactId: artifact.artifactId,
      seriesKey: artifact.seriesKey,
      revision: artifact.revision,
      contentChecksum: artifact.contentChecksum,
      latestState: artifact.latestState,
      latestSequence: artifact.latestSequence,
      contentVerified: verified !== null,
      gradable: !artifactGateFailed,
    },
    facts: verified ? artifactFacts(verified) : null,
    status,
    positions,
    issues,
    decisionsRequired,
    decisionsResolved,
    acknowledgmentsRequired,
    advisories,
    intakeFingerprint,
  };
}
