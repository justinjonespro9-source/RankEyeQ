import { prisma } from "@/lib/db";
import { rankingDepthForPosition } from "@/lib/contest-defaults";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export type LeagueResultDepthIssue = {
  position: ContestPosition;
  requiredDepth: number;
  found: number;
  message: string;
};

/**
 * How many league-wide weekly result rows can support Top-N actual ranks.
 */
export async function countLeagueResultsForPosition(
  weekId: string,
  position: ContestPosition,
): Promise<number> {
  if (position === "DEF") {
    return prisma.defenseWeekStat.count({
      where: {
        weekId,
        rankableEntryId: { not: null },
      },
    });
  }

  return prisma.playerWeekStat.count({
    where: {
      weekId,
      rankableEntry: { position },
    },
  });
}

export async function countLeagueRankedForPosition(
  weekId: string,
  position: ContestPosition,
  maxRank: number,
): Promise<number> {
  if (position === "DEF") {
    return prisma.defenseWeekStat.count({
      where: {
        weekId,
        leagueActualRank: { not: null, lte: maxRank },
      },
    });
  }

  return prisma.playerWeekStat.count({
    where: {
      weekId,
      leagueActualRank: { not: null, lte: maxRank },
      rankableEntry: { position },
    },
  });
}

export function formatLeagueDepthMessage(
  position: ContestPosition,
  requiredDepth: number,
  found: number,
): string {
  const unit =
    position === "DEF" ? "valid weekly defensive results" : "valid weekly player results";
  return `${position} requires at least ${requiredDepth} ${unit}; ${found} were found.`;
}

export async function getLeagueResultDepthIssues(
  weekId: string,
): Promise<LeagueResultDepthIssue[]> {
  const contests = await prisma.rankIQContest.findMany({
    where: { weekId },
    orderBy: { position: "asc" },
  });

  const issues: LeagueResultDepthIssue[] = [];

  for (const contest of contests) {
    const requiredDepth = Math.min(40, contest.rankingDepth);
    const ranked = await countLeagueRankedForPosition(
      weekId,
      contest.position,
      requiredDepth,
    );
    const withPoolRank = await prisma.contestEntry.count({
      where: {
        contestId: contest.id,
        excluded: false,
        actualRank: { not: null, lte: requiredDepth },
      },
    });
    const found = Math.max(ranked, withPoolRank);

    if (found < requiredDepth) {
      issues.push({
        position: contest.position,
        requiredDepth,
        found,
        message: formatLeagueDepthMessage(
          contest.position,
          requiredDepth,
          found,
        ),
      });
    }
  }

  return issues;
}

export async function requiredLeagueDepthForPosition(
  weekId: string,
  position: ContestPosition,
): Promise<number> {
  const contest = await prisma.rankIQContest.findUnique({
    where: { weekId_position: { weekId, position } },
    select: { rankingDepth: true },
  });
  if (!contest) return rankingDepthForPosition(position);
  return Math.min(40, contest.rankingDepth);
}
