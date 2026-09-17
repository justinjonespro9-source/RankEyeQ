import { prisma } from "@/lib/db";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import {
  matchupNotStampedMessage,
  resolveWeekScopedGame,
  type WeekScopedGame,
} from "@/lib/timing/resolve-contest-kickoff";
import { findGameForTeam } from "@/lib/providers/nfl/eligibility";

export type MatchupHealthCounts = {
  totalActive: number;
  correct: number;
  missingContestGame: number;
  staleOtherWeekGame: number;
  unmatchedTeam: number;
};

export type WeekMatchupHealth = {
  weekId: string;
  weekNumber: number;
  label: string;
  gameCount: number;
  ready: boolean;
  blockers: string[];
  byPosition: Record<ContestPosition, MatchupHealthCounts>;
  totals: MatchupHealthCounts;
};

function emptyCounts(): MatchupHealthCounts {
  return {
    totalActive: 0,
    correct: 0,
    missingContestGame: 0,
    staleOtherWeekGame: 0,
    unmatchedTeam: 0,
  };
}

/**
 * True when every active pool entry has ContestEntry.gameId pointing at this week's slate.
 * Stale RankableEntry kickoffs do not count as stamped.
 */
export async function assessWeekMatchupHealth(
  weekId: string,
): Promise<WeekMatchupHealth> {
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: weekId },
    include: {
      games: true,
      contests: {
        include: {
          entries: {
            where: { excluded: false },
            include: {
              game: true,
              rankableEntry: { select: { team: true, name: true } },
            },
          },
        },
      },
    },
  });

  const weekGames: WeekScopedGame[] = week.games.map((game) => ({
    id: game.id,
    weekId: game.weekId,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    startsAt: game.startsAt,
  }));
  const weekGameIds = new Set(weekGames.map((game) => game.id));

  const byPosition = Object.fromEntries(
    CONTEST_POSITIONS.map((position) => [position, emptyCounts()]),
  ) as Record<ContestPosition, MatchupHealthCounts>;
  const totals = emptyCounts();

  for (const contest of week.contests) {
    const counts = byPosition[contest.position] ?? emptyCounts();
    for (const entry of contest.entries) {
      counts.totalActive += 1;
      totals.totalActive += 1;
      const team = entry.weekTeam ?? entry.rankableEntry.team;
      const scoped = resolveWeekScopedGame({
        weekId: week.id,
        contestGame: entry.game
          ? {
              id: entry.game.id,
              weekId: entry.game.weekId,
              homeTeam: entry.game.homeTeam,
              awayTeam: entry.game.awayTeam,
              startsAt: entry.game.startsAt,
            }
          : null,
        team,
        weekGames,
      });

      if (entry.gameId && !weekGameIds.has(entry.gameId)) {
        counts.staleOtherWeekGame += 1;
        totals.staleOtherWeekGame += 1;
        continue;
      }

      if (scoped && entry.gameId === scoped.id) {
        counts.correct += 1;
        totals.correct += 1;
        continue;
      }

      if (!findGameForTeam(weekGames, team)) {
        counts.unmatchedTeam += 1;
        totals.unmatchedTeam += 1;
        continue;
      }

      counts.missingContestGame += 1;
      totals.missingContestGame += 1;
    }
    byPosition[contest.position] = counts;
  }

  const blockers: string[] = [];
  if (week.games.length === 0) {
    blockers.push(matchupNotStampedMessage(week.weekNumber));
  } else if (
    totals.missingContestGame > 0 ||
    totals.staleOtherWeekGame > 0 ||
    totals.unmatchedTeam > 0
  ) {
    blockers.push(matchupNotStampedMessage(week.weekNumber));
    if (totals.staleOtherWeekGame > 0) {
      blockers.push(
        `${totals.staleOtherWeekGame} active entries still point at another week's game.`,
      );
    }
    if (totals.missingContestGame > 0) {
      blockers.push(
        `${totals.missingContestGame} active entries are missing this week's ContestEntry.game link.`,
      );
    }
    if (totals.unmatchedTeam > 0) {
      blockers.push(
        `${totals.unmatchedTeam} active entries have no matching team on this week's schedule.`,
      );
    }
  }

  return {
    weekId: week.id,
    weekNumber: week.weekNumber,
    label: week.label,
    gameCount: week.games.length,
    ready: blockers.length === 0 && totals.totalActive > 0,
    blockers,
    byPosition,
    totals,
  };
}

export class WeekMatchupNotStampedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeekMatchupNotStampedError";
  }
}

export async function assertWeekMatchupsStamped(weekId: string) {
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: weekId },
    select: { isTest: true, weekNumber: true },
  });
  // Synthetic integration fixtures may omit full NflGame graphs.
  if (week.isTest) return null;

  const health = await assessWeekMatchupHealth(weekId);
  // Fail closed: zero games, partial stamp, or unmatched pool teams all block.
  if (!health.ready) {
    throw new WeekMatchupNotStampedError(
      health.blockers[0] ?? matchupNotStampedMessage(health.weekNumber),
    );
  }
  return health;
}
