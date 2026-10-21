import { prisma } from "@/lib/db";
import { readWaiverClock } from "@/lib/waivers/clock";
import type { WaiverPosition } from "@/lib/waivers/constants";
import type { WaiverGradedBoard, WaiverLeaderboardWeek } from "@/lib/waivers/leaderboard-model";

/**
 * Read-only queries for the public Waivers leaderboard. Never writes, never
 * grades, never stamps locks.
 */

/** Non-test weeks of the season, each with its official Waiver contests. */
export async function loadWaiverLeaderboardWeeks(seasonId: string): Promise<WaiverLeaderboardWeek[]> {
  const weeks = await prisma.week.findMany({
    where: { seasonId, isTest: false },
    orderBy: { weekNumber: "asc" },
    select: {
      id: true,
      weekNumber: true,
      label: true,
      isTest: true,
      waiverContests: {
        orderBy: { position: "asc" },
        select: { id: true, position: true, locksAt: true },
      },
    },
  });
  return weeks.map((week) => ({
    id: week.id,
    weekNumber: week.weekNumber,
    label: week.label,
    isTest: week.isTest,
    contests: week.waiverContests.map((contest) => ({
      id: contest.id,
      position: contest.position as WaiverPosition,
      locksAt: contest.locksAt,
    })),
  }));
}

/**
 * Authoritative graded Waiver boards for the given weeks, from PUBLISHED weeks
 * only. A week contributes boards when its CURRENT authority change (the one
 * its week, contest and board pointers all name) has an explicit publication.
 * Approved or applied-but-unpublished weeks, stored-only runs and previews
 * contribute nothing; a regrade is unpublished until it is published again.
 * Read-only: never grades or recomputes anything.
 */
export async function loadGradedWaiverBoards(weekIds: ReadonlyArray<string>): Promise<WaiverGradedBoard[]> {
  if (weekIds.length === 0) return [];
  const published = await prisma.waiverWeekGradeAuthority.findMany({
    where: { weekId: { in: [...weekIds] }, change: { publication: { isNot: null } } },
    select: { weekId: true, changeId: true },
  });
  if (published.length === 0) return [];
  const rows = await prisma.waiverBoardGradeAuthority.findMany({
    where: { OR: published.map((p) => ({ weekId: p.weekId, changeId: p.changeId })) },
    orderBy: { submissionId: "asc" },
    select: {
      weekId: true,
      submission: { select: { universalProfileId: true } },
      boardGrade: {
        select: {
          position: true,
          resultKind: true,
          scoreableCallCount: true,
          exactCallCount: true,
          eyeqHundredths: true,
          totalFpHundredths: true,
          fpPerAvailableSlotDenominator: true,
        },
      },
    },
  });
  return rows.map(({ weekId, submission, boardGrade }) => ({
    universalProfileId: submission.universalProfileId,
    weekId,
    position: boardGrade.position as WaiverPosition,
    // The board's own denominators: scoreable calls and effective available slots.
    availableSlots: boardGrade.fpPerAvailableSlotDenominator,
    callsMade: boardGrade.scoreableCallCount,
    eyeqHundredths: boardGrade.eyeqHundredths,
    totalFpHundredths: boardGrade.totalFpHundredths,
    // N/A (never zero) unless the board was scored with calls.
    perfectCalls: boardGrade.resultKind === "SCORED" && boardGrade.scoreableCallCount > 0 ? boardGrade.exactCallCount : null,
  }));
}

export function readWaiverLeaderboardClock(): Promise<Date> {
  return readWaiverClock();
}
