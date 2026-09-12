import type { ContestStatus } from "@/lib/generated/prisma/client";
import { contestAllowsRankingEdits } from "@/lib/contest-lifecycle";
import { getWeekTimingState } from "@/lib/timing/week-windows";

export type RankingEditAction = "draft" | "edit" | "submit";

/**
 * Competing submissions (human + admin AI) require:
 * - rankings open (now >= rankingsOpenAt)
 * - before Sunday Week.fullLockAt (source of truth for whole-board lock)
 * - week not COMPLETE/ARCHIVED
 * - contest not past ranking lifecycle (LIVE/GRADING/FINAL/ARCHIVED)
 *
 * Premature Contest.status=LOCKED before fullLockAt does NOT block edits
 * (stale locksAt / early lock bugs). Prefer Week.fullLockAt over Contest.locksAt.
 *
 * Per-player kickoff locks are enforced separately in validatePartialLockEdit.
 */
export function rankingEditWindowError(input: {
  contestStatus: ContestStatus;
  weekStatus: string;
  rankingsOpenAt?: Date | null;
  fullLockAt?: Date | null;
  revealStartsAt?: Date | null;
  publicReleaseAt?: Date | null;
  now: Date;
  action: RankingEditAction;
}): string | null {
  const timing = getWeekTimingState({
    rankingsOpenAt: input.rankingsOpenAt,
    fullLockAt: input.fullLockAt,
    revealStartsAt: input.revealStartsAt,
    publicReleaseAt: input.publicReleaseAt,
    weekStatus: input.weekStatus,
    now: input.now,
  });

  const weekClosed =
    input.weekStatus === "COMPLETE" || input.weekStatus === "ARCHIVED";

  if (
    !contestAllowsRankingEdits({
      contestStatus: input.contestStatus,
      fullBoardLocked: timing.fullBoardLocked,
      fullLockAt: input.fullLockAt,
      now: input.now,
    })
  ) {
    if (timing.fullBoardLocked || weekClosed) {
      return input.action === "submit"
        ? "Sunday full lock has passed — rankings can no longer be submitted"
        : input.action === "draft"
          ? "Contest is not open for new drafts"
          : "This ranking can no longer be edited";
    }
    return input.action === "submit"
      ? "Contest is not open for submissions"
      : "Contest is not open for new drafts";
  }

  if (!timing.canEditUnlocked) {
    if (timing.fullBoardLocked || weekClosed) {
      return input.action === "submit"
        ? "Sunday full lock has passed — rankings can no longer be submitted"
        : input.action === "draft"
          ? "Contest is not open for new drafts"
          : "This ranking can no longer be edited";
    }
    return "Weekly contests are not open yet";
  }

  return null;
}
