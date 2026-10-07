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
 * Authoritative graded Waiver boards for the given weeks. Waivers grading is
 * not persisted anywhere yet (no graded-result store exists), so there are no
 * authoritative results to read: this returns none rather than recomputing.
 * Once grading persists, its records come only from final competing boards
 * (`loadFinalWaiverBoards`: SUBMITTED / LOCKED, never drafts).
 */
export async function loadGradedWaiverBoards(weekIds: ReadonlyArray<string>): Promise<WaiverGradedBoard[]> {
  void weekIds;
  return [];
}

export function readWaiverLeaderboardClock(): Promise<Date> {
  return readWaiverClock();
}
