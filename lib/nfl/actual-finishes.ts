import { prisma } from "@/lib/db";
import { assignCompetitionRanks } from "@/lib/fantasy/competition-rank";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export type ActualFinishResult = {
  contestId: string;
  position: ContestPosition;
  ranked: number;
  tiedGroups: number;
};

const OFFENSIVE_POSITIONS: ContestPosition[] = ["QB", "RB", "WR", "TE"];

type ScoredRow = {
  id: string;
  rankableEntryId: string;
  fantasyPoints: number;
};

/**
 * Rank all NFL performers at a position for a week from normalized stat rows.
 * Writes leagueActualRank on stat rows and syncs ContestEntry.actualRank / fantasyPoints.
 */
export async function calculateLeagueActualFinishesForWeek(weekId: string) {
  const contests = await prisma.rankIQContest.findMany({
    where: { weekId },
    orderBy: { position: "asc" },
  });

  const results: ActualFinishResult[] = [];
  for (const contest of contests) {
    results.push(await calculateLeagueActualFinishesForContest(contest.id));
  }
  return results;
}

export async function calculateLeagueActualFinishesForContest(
  contestId: string,
): Promise<ActualFinishResult> {
  const contest = await prisma.rankIQContest.findUniqueOrThrow({
    where: { id: contestId },
  });

  const scored =
    contest.position === "DEF"
      ? await loadDefenseScoredRows(contest.weekId)
      : await loadOffensiveScoredRows(contest.weekId, contest.position);

  if (scored.length === 0) {
    throw new Error(
      `No fantasy stat rows for ${contest.position} in week ${contest.weekId}`,
    );
  }

  const ranked = assignCompetitionRanks(scored, (row) => row.fantasyPoints);

  const scoreCounts = new Map<number, number>();
  for (const row of ranked) {
    scoreCounts.set(row.score, (scoreCounts.get(row.score) ?? 0) + 1);
  }
  const tiedGroups = [...scoreCounts.values()].filter((count) => count > 1)
    .length;

  await prisma.$transaction(async (tx) => {
    for (const row of ranked) {
      const isStatRow =
        contest.position === "DEF"
          ? Boolean(
              await tx.defenseWeekStat.findUnique({
                where: { id: row.item.id },
                select: { id: true },
              }),
            )
          : Boolean(
              await tx.playerWeekStat.findUnique({
                where: { id: row.item.id },
                select: { id: true },
              }),
            );

      if (isStatRow) {
        if (contest.position === "DEF") {
          await tx.defenseWeekStat.update({
            where: { id: row.item.id },
            data: { leagueActualRank: row.rank },
          });
        } else {
          await tx.playerWeekStat.update({
            where: { id: row.item.id },
            data: { leagueActualRank: row.rank },
          });
        }
      }

      await tx.contestEntry.updateMany({
        where: {
          contestId: contest.id,
          rankableEntryId: row.item.rankableEntryId,
        },
        data: {
          actualRank: row.rank,
          fantasyPoints: row.item.fantasyPoints,
        },
      });
    }
  });

  return {
    contestId,
    position: contest.position,
    ranked: ranked.length,
    tiedGroups,
  };
}

async function loadOffensiveScoredRows(
  weekId: string,
  position: ContestPosition,
): Promise<ScoredRow[]> {
  const stats = await prisma.playerWeekStat.findMany({
    where: {
      weekId,
      rankableEntryId: { not: null },
      rankableEntry: { position },
    },
    select: {
      id: true,
      rankableEntryId: true,
      fantasyPoints: true,
    },
  });

  const fromStats = stats
    .filter((row): row is typeof row & { rankableEntryId: string } =>
      Boolean(row.rankableEntryId),
    )
    .map((row) => ({
      id: row.id,
      rankableEntryId: row.rankableEntryId,
      fantasyPoints: row.fantasyPoints,
    }));

  if (fromStats.length > 0) return fromStats;

  // Legacy/manual fallback when normalized stat rows are absent.
  const contest = await prisma.rankIQContest.findUnique({
    where: { weekId_position: { weekId, position } },
    include: {
      entries: {
        where: { fantasyPoints: { not: null } },
        select: { id: true, rankableEntryId: true, fantasyPoints: true },
      },
    },
  });

  return (
    contest?.entries.map((entry) => ({
      id: entry.id,
      rankableEntryId: entry.rankableEntryId,
      fantasyPoints: entry.fantasyPoints as number,
    })) ?? []
  );
}

async function loadDefenseScoredRows(weekId: string): Promise<ScoredRow[]> {
  const stats = await prisma.defenseWeekStat.findMany({
    where: {
      weekId,
      rankableEntryId: { not: null },
    },
    select: {
      id: true,
      rankableEntryId: true,
      fantasyPoints: true,
    },
  });

  const fromStats = stats
    .filter((row): row is typeof row & { rankableEntryId: string } =>
      Boolean(row.rankableEntryId),
    )
    .map((row) => ({
      id: row.id,
      rankableEntryId: row.rankableEntryId,
      fantasyPoints: row.fantasyPoints,
    }));

  if (fromStats.length > 0) return fromStats;

  const contest = await prisma.rankIQContest.findUnique({
    where: { weekId_position: { weekId, position: "DEF" } },
    include: {
      entries: {
        where: { fantasyPoints: { not: null } },
        select: { id: true, rankableEntryId: true, fantasyPoints: true },
      },
    },
  });

  return (
    contest?.entries.map((entry) => ({
      id: entry.id,
      rankableEntryId: entry.rankableEntryId,
      fantasyPoints: entry.fantasyPoints as number,
    })) ?? []
  );
}

/** @deprecated Use calculateLeagueActualFinishesForWeek — kept as alias. */
export async function calculateActualFinishesForWeek(weekId: string) {
  return calculateLeagueActualFinishesForWeek(weekId);
}

/** @deprecated Use calculateLeagueActualFinishesForContest — kept as alias. */
export async function calculateActualFinishesForContest(contestId: string) {
  return calculateLeagueActualFinishesForContest(contestId);
}

export { OFFENSIVE_POSITIONS };
