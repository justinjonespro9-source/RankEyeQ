import type { ContestStatus, SubmissionStatus } from "@/lib/generated/prisma/client";

const EDITABLE_CONTEST_STATUSES: ContestStatus[] = ["DRAFT", "OPEN"];

/** Contest statuses that are past the ranking-edit lifecycle (not premature Sunday lock). */
const POST_RANKING_CONTEST_STATUSES: ContestStatus[] = [
  "LIVE",
  "GRADING",
  "FINAL",
  "ARCHIVED",
];

const LOCKING_CONTEST_STATUSES: ContestStatus[] = [
  "LOCKED",
  "LIVE",
  "GRADING",
  "FINAL",
  "ARCHIVED",
];

/** Contests that accept ranking edits when status alone is considered. */
export function contestAllowsEdits(status: ContestStatus): boolean {
  return EDITABLE_CONTEST_STATUSES.includes(status);
}

/**
 * Ranking edit gate preferred for RankEyeQ hybrid locking.
 * Week.fullLockAt is the source of truth for whole-board lock.
 * Premature Contest.status=LOCKED before Sunday fullLockAt does NOT block edits.
 * Contest LOCKED without a future fullLockAt (admin lock / no timing) still blocks.
 */
export function contestAllowsRankingEdits(input: {
  contestStatus: ContestStatus;
  fullBoardLocked: boolean;
  fullLockAt?: Date | null;
  now?: Date;
}): boolean {
  if (input.fullBoardLocked) return false;
  if (POST_RANKING_CONTEST_STATUSES.includes(input.contestStatus)) return false;
  if (
    input.contestStatus === "DRAFT" ||
    input.contestStatus === "OPEN"
  ) {
    return true;
  }
  if (input.contestStatus === "LOCKED") {
    const now = input.now ?? new Date();
    if (input.fullLockAt && now < input.fullLockAt) return true;
    return false;
  }
  return false;
}

export function contestIsLockedForRankings(status: ContestStatus): boolean {
  return LOCKING_CONTEST_STATUSES.includes(status);
}

/** Submission-level editability given contest + submission status. */
export function submissionAllowsEdits(
  contestStatus: ContestStatus,
  submissionStatus: SubmissionStatus,
): boolean {
  if (!contestAllowsEdits(contestStatus)) return false;
  if (submissionStatus === "LOCKED" || submissionStatus === "GRADED") {
    return false;
  }
  // DRAFT and SUBMITTED remain editable while contest is DRAFT/OPEN
  return true;
}

/**
 * Hybrid-lock submission gate: SUBMITTED stays editable until Week.fullLockAt.
 * Premature submission LOCKED (before global lock) is treated as still editable.
 */
export function submissionAllowsRankingEdits(input: {
  contestStatus: ContestStatus;
  submissionStatus: SubmissionStatus;
  fullBoardLocked: boolean;
  fullLockAt?: Date | null;
  now?: Date;
}): boolean {
  if (!contestAllowsRankingEdits(input)) return false;
  if (input.submissionStatus === "GRADED") return false;
  if (input.submissionStatus === "LOCKED") {
    const now = input.now ?? new Date();
    // Premature submission LOCKED before Sunday full lock remains editable.
    if (input.fullLockAt && now < input.fullLockAt && !input.fullBoardLocked) {
      return true;
    }
    return false;
  }
  return (
    input.submissionStatus === "DRAFT" ||
    input.submissionStatus === "SUBMITTED"
  );
}

/** Only explicitly SUBMITTED (or later LOCKED/GRADED) rankings compete. */
export function submissionIsEligible(status: SubmissionStatus): boolean {
  return (
    status === "SUBMITTED" || status === "LOCKED" || status === "GRADED"
  );
}

export function canTransitionContest(
  from: ContestStatus,
  to: ContestStatus,
): boolean {
  if (from === to) return true;

  const allowed: Record<ContestStatus, ContestStatus[]> = {
    DRAFT: ["OPEN", "ARCHIVED"],
    OPEN: ["LOCKED", "DRAFT", "ARCHIVED"],
    LOCKED: ["LIVE", "GRADING", "OPEN", "ARCHIVED"],
    LIVE: ["GRADING", "LOCKED", "ARCHIVED"],
    GRADING: ["FINAL", "LOCKED", "ARCHIVED"],
    FINAL: ["GRADING", "ARCHIVED"], // regrade allowed via GRADING
    ARCHIVED: ["FINAL"],
  };

  return allowed[from]?.includes(to) ?? false;
}

export const CONTEST_STATUS_ACTIONS: {
  status: ContestStatus;
  label: string;
}[] = [
  { status: "OPEN", label: "Open Contest" },
  { status: "LOCKED", label: "Lock Contest" },
  { status: "LIVE", label: "Mark Live" },
  { status: "GRADING", label: "Mark Grading" },
  { status: "FINAL", label: "Finalize Contest" },
  { status: "ARCHIVED", label: "Archive Contest" },
  { status: "DRAFT", label: "Revert to Draft" },
];
