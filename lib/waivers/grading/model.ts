import type { PreflightIssueCode } from "@/lib/waivers/canonical/preflight-model";
import type { WaiverPosition } from "@/lib/waivers/constants";
import type { BoardGradeOutput, CallGradeOutput, PoolRowFingerprintInput } from "@/lib/waivers/results/fingerprints";

/**
 * Shared shapes of the Stage 4B.4 WaiverEyeQ grading engine. The engine is a
 * deterministic calculation and validation layer: it derives contest results,
 * pool rows, board grades and call grades in the exact shape of the Stage 4B.3
 * storage tables, with their fingerprints, and reports every blocker. It never
 * writes, approves or applies anything.
 */

export const WAIVER_GRADING_ISSUE_CODES = [
  // Artifact (D5) and week inputs
  "ARTIFACT_NOT_FOUND",
  "ARTIFACT_WEEK_MISMATCH",
  "ARTIFACT_NOT_ACCEPTED",
  "ARTIFACT_NOT_LATEST",
  "ARTIFACT_CONTENT_INVALID",
  "DEF_CROSSWALK_VERSION_MISMATCH",
  "CURRENT_SNAPSHOT_MISSING",
  "CONTEST_MISSING",
  "CONTEST_NOT_LOCKED",
  "CONTEST_RULES_MISMATCH",
  "SUBMISSION_NOT_LOCK_STAMPED",
  // Canonical reconciliation of the frozen pool and invalidated called players
  "RESULT_SET_MISSING",
  "RESULT_ENTRY_MISSING",
  "RESULT_ENTRY_MISMATCH",
  "CALLED_IDENTITY_AMBIGUOUS",
  // RankEyeQ results source (identity and provenance checks the SNG path does not have)
  "RANKABLE_ENTRY_MISMATCH",
  "SOURCE_WEEK_MISMATCH",
  "SOURCE_SNAPSHOT_MISMATCH",
  "UNRESOLVED_SNAPSHOT_CONFLICT",
  "CONFLICT_RESOLUTION_NOT_APPLICABLE",
  "UNAPPLIED_CONFLICT_RESOLUTION",
  // Boards
  "BOARD_REVISION_INVALID",
  "BOARD_SLOTS_NOT_CONTIGUOUS",
  "BOARD_CALL_WITHOUT_POOL_ROW",
  "BOARD_CALLS_EXCEED_SLOTS",
] as const;

export type WaiverGradingIssueCode = (typeof WAIVER_GRADING_ISSUE_CODES)[number] | PreflightIssueCode;

export type WaiverGradingIssue = {
  code: WaiverGradingIssueCode;
  detail: string;
  position?: WaiverPosition;
  snapshotEntryId?: string;
  submissionId?: string;
};

export type WaiverGradingAdvisoryCode =
  | "TEAM_CROSSWALK_PENDING_PRODUCER_CONFIRMATION"
  | "IDENTITY_KEY_NOT_FROZEN_AT_SNAPSHOT"
  | "CANONICAL_POSITION_DIFFERS"
  | "CONTEST_SNAPSHOT_NOT_CURRENT"
  | "CONTEST_RESULT_ALREADY_STORED"
  | "GRADE_RUN_ALREADY_STORED"
  /** Every locked board is graded; an inactive non-human competitor's board is surfaced for review, never dropped. */
  | "INACTIVE_COMPETITOR_LOCKED_BOARD";

export type WaiverGradingAdvisory = { code: WaiverGradingAdvisoryCode; detail: string; position?: WaiverPosition };

/** A WaiverPoolResult row (without ids) plus non-stored diagnostics. */
export type WaiverGradingPoolRow = Omit<PoolRowFingerprintInput, "resolution"> & {
  conflictResolutionId: string | null;
  invalidatedBySnapshotId: string | null;
  rowFingerprint: string;
  /** Not stored: the applied resolution's key (fingerprinted), display name and SNG position. */
  meta: {
    resolution: { conflictKey: string; sequence: number } | null;
    displayName: string;
    sngPosition: string;
  };
};

/** The WaiverContestResult columns the engine derives (version and ids are assigned at storage). */
export type WaiverGradingContestResult = {
  contestId: string;
  weekId: string;
  position: WaiverPosition;
  snapshotId: string;
  artifactRowId: string;
  artifactContentChecksum: string;
  resultsPolicyVersion: string;
  sngResultSetChecksum: string;
  sourceFingerprint: string;
  snapshotFingerprint: string;
  resolutionSetFingerprint: string;
  inputFingerprint: string;
  resultFingerprint: string;
  resultFieldSize: number;
  eligiblePoolSize: number;
  effectivePoolSize: number;
  effectiveFieldSize: number;
  effectiveAvailableSlots: number;
  invalidatedCalledCount: number;
};

export type WaiverGradingAppliedResolution = {
  id: string;
  conflictKey: string;
  sequence: number;
  conflictKind: "BYE_VS_SCHEDULED" | "TEAM_CHANGED";
  resolution: "SCORE_AS_RANKED" | "NON_PARTICIPANT_ZERO" | "NEUTRALIZED";
};

export type WaiverCallOutcome = "EXACT" | "IN_RESULT_FIELD" | "OUTSIDE_RESULT_FIELD" | "NON_PARTICIPANT_ZERO" | "INVALIDATED_PRE_LOCK" | "NEUTRALIZED";

/** A WaiverCallGrade row (without board/pool ids) plus its per-call breakdown. */
export type WaiverGradingCallGrade = CallGradeOutput & {
  callId: string;
  snapshotEntryId: string;
  rankableEntryId: string;
  conflictResolutionId: string | null;
  inputFingerprint: string;
  outputFingerprint: string;
  /** Not stored. */
  poolRowFingerprint: string;
  outcome: WaiverCallOutcome;
};

export type WaiverCompetitor = {
  universalProfileId: string;
  profileType: string;
  competitorActive: boolean;
  authority: string;
  /** How the locked revision entered the contest (graded identically). */
  entryBasis: "STANDARD" | "AI_LATE_ENTRY" | "ADMIN_COMPETITIVE_OVERRIDE";
};

/** A WaiverBoardGrade row (without run/result ids) and its calls. */
export type WaiverGradingBoardGrade = {
  board: BoardGradeOutput & {
    contestId: string;
    position: WaiverPosition;
    submissionId: string;
    revisionId: string;
    fpPerCallDenominator: number;
    fpPerAvailableSlotDenominator: number;
    inputFingerprint: string;
    outputFingerprint: string;
  };
  calls: WaiverGradingCallGrade[];
  competitor: WaiverCompetitor;
  /** Not stored: the contest's full-board honor slots. */
  honorScoreableSlots: number;
};
