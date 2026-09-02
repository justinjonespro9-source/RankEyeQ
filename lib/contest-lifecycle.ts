import type { ContestStatus, SubmissionStatus } from "@/lib/generated/prisma/client";

const EDITABLE_CONTEST_STATUSES: ContestStatus[] = ["DRAFT", "OPEN"];

const LOCKING_CONTEST_STATUSES: ContestStatus[] = [
  "LOCKED",
  "LIVE",
  "GRADING",
  "FINAL",
  "ARCHIVED",
];

/** Contests that accept ranking edits. */
export function contestAllowsEdits(status: ContestStatus): boolean {
  return EDITABLE_CONTEST_STATUSES.includes(status);
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
