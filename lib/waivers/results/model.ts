/**
 * Pure vocabulary for Waiver results and grading storage (Stage 4B.3). The
 * versions below are also pinned by database CHECK constraints; changing one
 * requires a migration. Nothing here grades, loads or persists anything.
 */

/** WaiverContestResult.resultsPolicyVersion (Stage 4A D1/D2/D3/C2 interpretation). */
export const WAIVER_RESULTS_POLICY_VERSION = "rankeyeq-waiver-results/1";

/** WaiverGradeRun.gradingRulesetVersion (WAIVER_EYEQ_V1 scoring, Stage 4A honors and N/A board rules). */
export const WAIVER_GRADING_RULESET_VERSION = "rankeyeq-waiver-grading/1";

export const WAIVER_GRADE_APPROVAL_POLICIES = ["SINGLE_ADMIN_EXPLICIT", "SEPARATE_APPROVER"] as const;
export type WaiverGradeApprovalPolicy = (typeof WAIVER_GRADE_APPROVAL_POLICIES)[number];

/**
 * V1 policy: the importing admin may also approve grading, but only through a
 * separate, explicit, immutable approval record. Importing never approves.
 */
export const WAIVER_GRADING_APPROVAL_POLICY: WaiverGradeApprovalPolicy = "SINGLE_ADMIN_EXPLICIT";

export const WAIVER_GRADING_APPROVAL_ATTESTATION_VERSION = "rankeyeq-waiver-grading-approval/1";
export const WAIVER_GRADING_APPROVAL_ATTESTATION_TEXT =
  "I approve this exact Waivers grade run for competitive use: its canonical artifact revision, frozen snapshots, " +
  "D3 resolution set and complete week output fingerprint. I have reviewed the DEF team crosswalk version it uses. " +
  "This approval is separate from, and not implied by, the artifact import.";

export const WAIVER_HONOR_INELIGIBLE_REASONS = {
  NA_ZERO_CALL: "ZERO_CALL_BOARD",
  NA_ALL_NEUTRALIZED: "ALL_CALLS_NEUTRALIZED",
  NA_NO_EFFECTIVE_SLOTS: "NO_EFFECTIVE_SLOTS",
} as const;

/**
 * Why a board is NA_NO_EFFECTIVE_SLOTS: scoreable calls remain after a
 * pre-lock correction but no effective available slot does. Derived from the
 * board's counts and pinned by a database CHECK.
 */
export const WAIVER_UNGRADABLE_REASONS = ["CORRECTED_POOL_EMPTY", "NEUTRALIZATIONS_CONSUMED_SLOTS"] as const;
export type WaiverUngradableReason = (typeof WAIVER_UNGRADABLE_REASONS)[number];

export function deriveWaiverUngradableReason(availableSlots: number): WaiverUngradableReason {
  return availableSlots === 0 ? "CORRECTED_POOL_EMPTY" : "NEUTRALIZATIONS_CONSUMED_SLOTS";
}

export type WaiverGradeRunLifecycle =
  | "PROPOSED"
  | "APPROVED_NOT_APPLIED"
  | "CURRENT"
  | "CURRENT_SOURCE_SUPERSEDED"
  | "CURRENT_SOURCE_WITHDRAWN"
  | "SUPERSEDED";

/**
 * Lifecycle of a grade run, derived from approvals, the append-only
 * authority log, the week pointer and the artifact's publication state.
 * Never stored, so it cannot drift from the rows it summarizes.
 */
export function deriveWaiverGradeRunLifecycle(input: {
  gradeRunId: string;
  approved: boolean;
  /** Week authority pointer's grade run, or null when the week was never graded. */
  currentGradeRunId: string | null;
  /** The run appears as newGradeRunId in some authority change. */
  everAuthoritative: boolean;
  artifactState: "ACCEPTED" | "SUPERSEDED" | "WITHDRAWN";
}): WaiverGradeRunLifecycle {
  if (input.currentGradeRunId === input.gradeRunId) {
    if (input.artifactState === "WITHDRAWN") return "CURRENT_SOURCE_WITHDRAWN";
    if (input.artifactState === "SUPERSEDED") return "CURRENT_SOURCE_SUPERSEDED";
    return "CURRENT";
  }
  if (input.everAuthoritative) return "SUPERSEDED";
  return input.approved ? "APPROVED_NOT_APPLIED" : "PROPOSED";
}
