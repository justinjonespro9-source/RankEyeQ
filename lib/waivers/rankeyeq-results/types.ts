import type {
  RankEyeQParticipantDisposition,
  RankEyeQParticipantKind,
  RankEyeQParticipationProof,
  RankEyeQParticipationState,
  RankEyeQResultsPosition,
  RankEyeQZeroPointDecision,
} from "@/lib/waivers/rankeyeq-results/contract";

/**
 * Immutable content of one `rankeyeq-final-week-stats/1` snapshot. Everything
 * here is covered by the content checksum, so it holds only deterministic
 * values: no clocks, no floats (fantasy points are integer hundredths), no
 * mutable live fields beyond the identity and stat facts copied at build.
 */

export type RankEyeQParticipantIssueCode =
  | "STAT_ROW_MISSING"
  | "STAT_ROW_DUPLICATE"
  | "STAT_ROW_PROVISIONAL"
  | "STAT_SCORING_VERSION_MISMATCH"
  | "FANTASY_POINTS_NOT_REPRESENTABLE"
  | "NO_GAME_LINKED"
  | "GAME_NOT_FINAL"
  | "IDENTITY_PROVIDER_NOT_CONTRACT"
  | "FROZEN_IDENTITY_MISMATCH"
  | "DEF_IDENTITY_MALFORMED"
  /** A called player absent from the snapshot was called under more than one frozen identity. */
  | "CALLED_IDENTITY_AMBIGUOUS"
  /** Advisory only: the freeze predates the frozen identity key, so the live RankableEntry identity was used. */
  | "IDENTITY_NOT_FROZEN";

export const RANKEYEQ_ADVISORY_ISSUE_CODES: ReadonlySet<RankEyeQParticipantIssueCode> = new Set(["IDENTITY_NOT_FROZEN"]);

export type RankEyeQParticipantIssue = { code: RankEyeQParticipantIssueCode; detail: string };

/** An operator zero-point review that has been applied to a participant. */
export type RankEyeQRecordedDecision = {
  decision: Exclude<RankEyeQZeroPointDecision, "PENDING">;
  evidenceReference: string;
  reason: string;
  decidedByUserId: string;
  /** ISO-8601 UTC. */
  decidedAt: string;
};

export type RankEyeQGameEvidence = { gameId: string; status: string };

export type RankEyeQParticipantEvidence = {
  /** Which RankEyeQ WeekStat table backs the participant (DEF reads DefenseWeekStat). */
  statTable: "PlayerWeekStat" | "DefenseWeekStat";
  statRowId: string | null;
  statProvider: string | null;
  statScoringVersion: string | null;
  isProvisional: boolean | null;
  games: readonly RankEyeQGameEvidence[];
  decision: RankEyeQRecordedDecision | null;
  issues: readonly RankEyeQParticipantIssue[];
};

export type RankEyeQParticipant = {
  rankableEntryId: string;
  snapshotEntryId: string;
  /** Frozen RankableEntry identity (nflcom-bootstrap + externalId; DEF is `def-{TEAM}`). */
  provider: string;
  externalId: string;
  kind: RankEyeQParticipantKind;
  /** Competitive (snapshot) position. */
  position: RankEyeQResultsPosition;
  team: string | null;
  /** Diagnostic only; never resolves a match. */
  displayName: string;
  participationState: RankEyeQParticipationState;
  disposition: RankEyeQParticipantDisposition;
  proof: RankEyeQParticipationProof;
  /** Fantasy points in integer hundredths (via toFpHundredths); null unless the participant is scorable. */
  pointsHundredths: number | null;
  /** Sorted NflGame ids that back the stat line (stat row game and frozen snapshot game). */
  gameIds: readonly string[];
  evidence: RankEyeQParticipantEvidence;
};

export type RankEyeQContestRef = {
  contestId: string;
  position: RankEyeQResultsPosition;
  status: string;
  snapshotId: string;
};

export type RankEyeQFinalWeekStatsSummary = {
  participantCount: number;
  byState: Readonly<Record<RankEyeQParticipationState, number>>;
  pendingZeroCount: number;
  unresolvedCount: number;
};

export type RankEyeQFinalWeekStatsContent = {
  schemaVersion: string;
  sourceKind: string;
  seriesKey: string;
  week: { id: string; season: number; weekNumber: number };
  /** Must equal RANKEYEQ_FANTASY_SCORING_VERSION. */
  scoringVersion: string;
  /** Week.status when built; must be COMPLETE. */
  rankingsWeekStatus: string;
  /** The RankEyeQ week whose WeekStat rows were read (equals week.id). */
  sourceWeekId: string;
  statProvider: string;
  waiverSnapshot: { id: string; version: number; entriesFingerprint: string };
  contests: readonly RankEyeQContestRef[];
  participants: readonly RankEyeQParticipant[];
  summary: RankEyeQFinalWeekStatsSummary;
};

export type RankEyeQBuildBlockerCode =
  | "WEEK_NOT_COMPLETE"
  | "WEEK_SCORING_VERSION_MISMATCH"
  | "WEEK_GAMES_NOT_FINAL"
  | "NO_CURRENT_FROZEN_SNAPSHOT"
  | "CONTEST_NOT_LOCKED"
  | "CONTEST_SNAPSHOT_MISMATCH";

export type RankEyeQBuildBlocker = { code: RankEyeQBuildBlockerCode; detail: string };

export type RankEyeQFinalWeekStatsBuild = {
  /** Null when a week-level prerequisite blocks the build. */
  content: RankEyeQFinalWeekStatsContent | null;
  blockers: readonly RankEyeQBuildBlocker[];
  contentChecksum: string | null;
};

/** Participation review items an operator must resolve before ACCEPTED publication. */
export type RankEyeQParticipationReviewItem = {
  rankableEntryId: string;
  provider: string;
  externalId: string;
  position: RankEyeQResultsPosition;
  team: string | null;
  displayName: string;
  /**
   * ZERO_POINT_REVIEW: PLAYED_ZERO or DID_NOT_PLAY with evidence.
   * ABSENT_DNP_REVIEW: DID_NOT_PLAY with evidence only (missing WeekStat is never a played zero).
   */
  reviewKind: "ZERO_POINT_REVIEW" | "ABSENT_DNP_REVIEW";
  state: Extract<RankEyeQParticipationState, "PENDING_ZERO_REVIEW" | "ABSENT_UNRESOLVED">;
  statRowId: string | null;
  gameIds: readonly string[];
  issues: readonly RankEyeQParticipantIssue[];
};

export type RankEyeQParticipationDecisionInput = {
  rankableEntryId: string;
  decision: RankEyeQZeroPointDecision;
  evidenceReference: string;
  reason: string;
  decidedByUserId: string;
  decidedAt: Date | string;
};

export type RankEyeQDecisionRejectionCode =
  | "UNKNOWN_ENTRY"
  | "DUPLICATE_DECISION"
  | "UNRESOLVED_CANNOT_BE_ZEROED"
  | "NOT_PENDING_ZERO_REVIEW"
  | "EVIDENCE_REQUIRED"
  | "REASON_REQUIRED"
  | "DECIDER_REQUIRED"
  | "DECIDED_AT_INVALID"
  | "DECISION_UNKNOWN";

export type RankEyeQDecisionRejection = { rankableEntryId: string; code: RankEyeQDecisionRejectionCode; detail: string };
