import type {
  ContestStatus,
  SubmissionStatus,
} from "@/lib/generated/prisma/client";
import { toUiPosition } from "@/lib/contest-defaults";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export function ctaForContestState(
  contestStatus: ContestStatus,
  submissionStatus: SubmissionStatus | null,
): string {
  if (contestStatus === "FINAL" || contestStatus === "ARCHIVED") {
    return "View Results";
  }
  if (
    contestStatus === "LOCKED" ||
    contestStatus === "LIVE" ||
    contestStatus === "GRADING"
  ) {
    if (
      submissionStatus === "SUBMITTED" ||
      submissionStatus === "LOCKED" ||
      submissionStatus === "GRADED"
    ) {
      return "View My Ranks";
    }
    return "View Locked Rankings";
  }
  if (submissionStatus === "SUBMITTED") {
    return "Edit Rankings";
  }
  if (submissionStatus === "DRAFT") {
    return "Continue Your Rankings";
  }
  return "Build Rankings";
}

/** Prefer My Ranks for locked/live submitted boards. */
export function hrefForContestState(input: {
  position: ContestPosition | string;
  contestStatus: ContestStatus;
  submissionStatus: SubmissionStatus | null;
  resultsHref?: string;
}): string {
  const ui =
    typeof input.position === "string" && input.position.length <= 3
      ? input.position.toLowerCase()
      : toUiPosition(input.position as ContestPosition);

  if (
    (input.contestStatus === "FINAL" || input.contestStatus === "ARCHIVED") &&
    input.resultsHref
  ) {
    return input.resultsHref;
  }

  if (
    (input.contestStatus === "LOCKED" ||
      input.contestStatus === "LIVE" ||
      input.contestStatus === "GRADING") &&
    (input.submissionStatus === "SUBMITTED" ||
      input.submissionStatus === "LOCKED" ||
      input.submissionStatus === "GRADED")
  ) {
    return `/my-ranks?position=${ui}`;
  }

  return `/rank/${ui}`;
}
