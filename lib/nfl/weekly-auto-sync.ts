import { prisma } from "@/lib/db";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { syncWeeklyEligibleFieldFromSeason } from "@/lib/nfl/weekly-eligibility";
import { isMutableWeeklyPool } from "@/lib/nfl/weekly-pool-mutable";
import { logServerEvent } from "@/lib/log";

export type WeeklyAutoSyncResult = {
  weekId: string;
  skipped?: boolean;
  byPosition: Record<
    ContestPosition,
    {
      created: number;
      updated: number;
      activated: number;
      skippedIneligible: number;
      skippedNonCanonical?: number;
      pruned: number;
    }
  >;
};

/**
 * Populate weekly contest fields from the season universe for all positions.
 * Preserves admin exclusions (inactiveReason / manuallyAdded).
 */
export async function autoSyncWeeklyEligibilityForWeek(
  weekId: string,
): Promise<WeeklyAutoSyncResult> {
  const mutable = await isMutableWeeklyPool(weekId);
  if (!mutable) {
    return { weekId, skipped: true, byPosition: {} as WeeklyAutoSyncResult["byPosition"] };
  }

  const byPosition = {} as WeeklyAutoSyncResult["byPosition"];

  for (const position of CONTEST_POSITIONS) {
    const result = await syncWeeklyEligibleFieldFromSeason({
      weekId,
      position,
      scheduledTeamsOnly: true,
    });
    byPosition[position] = {
      created: result.created,
      updated: result.updated,
      activated: result.activated,
      skippedIneligible: result.skippedIneligible,
      skippedNonCanonical: result.skippedNonCanonical,
      pruned: result.pruned,
    };
  }

  logServerEvent("weekly.eligibility_auto_synced", {
    weekId,
    positions: CONTEST_POSITIONS.length,
  });

  return { weekId, byPosition };
}

/** Sync eligibility for every non-archived week in a season (e.g. after roster sync). */
export async function autoSyncWeeklyEligibilityForSeason(seasonId: string) {
  const weeks = await prisma.week.findMany({
    where: {
      seasonId,
      status: { notIn: ["ARCHIVED", "COMPLETE", "LOCKED"] },
      isTest: false,
    },
    select: { id: true, weekNumber: true },
    orderBy: { weekNumber: "asc" },
  });

  const results: WeeklyAutoSyncResult[] = [];
  for (const week of weeks) {
    const games = await prisma.nflGame.count({ where: { weekId: week.id } });
    if (games === 0) continue;
    const mutable = await isMutableWeeklyPool(week.id);
    if (!mutable) continue;
    results.push(await autoSyncWeeklyEligibilityForWeek(week.id));
  }
  return results;
}

export async function getWeeklyEligibilitySyncStatus(weekId: string) {
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: weekId },
    include: {
      games: { select: { id: true } },
      contests: {
        include: {
          entries: {
            select: { excluded: true, inactiveReason: true, manuallyAdded: true },
          },
        },
      },
    },
  });

  const scheduledTeams = new Set<string>();
  for (const game of await prisma.nflGame.findMany({
    where: { weekId },
    select: { homeTeam: true, awayTeam: true },
  })) {
    scheduledTeams.add(game.homeTeam);
    scheduledTeams.add(game.awayTeam);
  }

  const seasonPlayers = await prisma.seasonPlayer.count({
    where: {
      seasonId: week.seasonId,
      activeOnNFLRoster: true,
      ...(scheduledTeams.size > 0
        ? { team: { in: [...scheduledTeams] } }
        : {}),
    },
  });

  const activeEntries = week.contests.reduce(
    (sum, contest) =>
      sum + contest.entries.filter((entry) => !entry.excluded).length,
    0,
  );
  const excludedWithReason = week.contests.reduce(
    (sum, contest) =>
      sum +
      contest.entries.filter(
        (entry) => entry.excluded && Boolean(entry.inactiveReason?.trim()),
      ).length,
    0,
  );

  return {
    weekId,
    weekLabel: week.label,
    hasSchedule: week.games.length > 0,
    contestsReady: week.contests.length === 5,
    seasonPlayerCandidates: seasonPlayers,
    activePoolEntries: activeEntries,
    adminExclusions: excludedWithReason,
    needsSync:
      week.games.length > 0 &&
      week.contests.length === 5 &&
      activeEntries < Math.min(seasonPlayers, 1),
  };
}
