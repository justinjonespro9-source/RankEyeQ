import type {
  ContestStatus,
  SubmissionStatus,
} from "@/lib/generated/prisma/client";

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
    return "View Locked Rankings";
  }
  if (submissionStatus === "SUBMITTED" || submissionStatus === "DRAFT") {
    return "Edit Rankings";
  }
  return "Build Rankings";
}
