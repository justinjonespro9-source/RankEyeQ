import { prisma } from "@/lib/db";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import {
  aggregatePlayerResearchStats,
  type PlayerResearchStatLine,
  type PlayerResearchWindow,
  sortPlayerResearchStats,
} from "@/lib/player-research";

export type LeagueWeeklyResultRow = {
  rankableEntryId: string;
  name: string;
  team: string;
  actualRank: number;
  fantasyPoints: number;
  selectionRate: number | null;
  averageSelectedRank: number | null;
  consensusRank: number | null;
  consensusVsActual: number | null;
};

/**
 * League-wide weekly actual results (Top N by leagueActualRank).
 * Includes players who were not widely selected pregame.
 */
export async function getLeagueWeeklyResults(input: {
  contestId: string;
  limit?: number;
  segment?: "ALL" | "HUMAN" | "AI" | "EXPERT";
}): Promise<LeagueWeeklyResultRow[]> {
  const limit = input.limit ?? 40;
  const segment = input.segment ?? "ALL";

  const contest = await prisma.rankIQContest.findUniqueOrThrow({
    where: { id: input.contestId },
    include: {
      week: true,
      pregameSnapshot: { include: { entries: true } },
    },
  });

  const snapshotByPlayer = new Map(
    contest.pregameSnapshot?.entries.map((entry) => [
      entry.rankableEntryId,
      entry,
    ]) ?? [],
  );

  const rows =
    contest.position === "DEF"
      ? await prisma.defenseWeekStat.findMany({
          where: {
            weekId: contest.weekId,
            leagueActualRank: { not: null },
            rankableEntryId: { not: null },
          },
          include: { rankableEntry: true },
          orderBy: { leagueActualRank: "asc" },
          take: limit,
        })
      : await prisma.playerWeekStat.findMany({
          where: {
            weekId: contest.weekId,
            leagueActualRank: { not: null },
            rankableEntry: { position: contest.position },
            rankableEntryId: { not: null },
          },
          include: { rankableEntry: true },
          orderBy: { leagueActualRank: "asc" },
          take: limit,
        });

  return rows.map((row) => {
    const rankableEntryId = row.rankableEntryId as string;
    const actualRank = row.leagueActualRank as number;
    const snap = snapshotByPlayer.get(rankableEntryId);

    let selectionRate: number | null = null;
    let averageSelectedRank: number | null = null;
    let consensusRank: number | null = null;

    if (snap) {
      if (segment === "HUMAN") {
        selectionRate = snap.selectionRateHuman;
        averageSelectedRank = snap.averageSelectedRankHuman;
        consensusRank = snap.consensusRankHuman;
      } else if (segment === "AI") {
        selectionRate = snap.selectionRateAi;
        averageSelectedRank = snap.averageSelectedRankAi;
        consensusRank = snap.consensusRankAi;
      } else if (segment === "EXPERT") {
        selectionRate = snap.selectionRateExpert;
        averageSelectedRank = snap.averageSelectedRankExpert;
        consensusRank = snap.consensusRankExpert;
      } else {
        selectionRate = snap.selectionRateAll;
        averageSelectedRank = snap.averageSelectedRankAll;
        consensusRank = snap.consensusRankAll;
      }
    }

    return {
      rankableEntryId,
      name: row.rankableEntry?.name ?? "Unknown",
      team: row.rankableEntry?.team ?? "—",
      actualRank,
      fantasyPoints: row.fantasyPoints,
      selectionRate,
      averageSelectedRank,
      consensusRank,
      consensusVsActual:
        consensusRank == null ? null : actualRank - consensusRank,
    };
  });
}

export async function loadSeasonResearchAppearances(input: {
  seasonId: string;
  position: ContestPosition;
  includeTest?: boolean;
}) {
  const weeks = await prisma.week.findMany({
    where: {
      seasonId: input.seasonId,
      ...(input.includeTest ? {} : { isTest: false }),
    },
    orderBy: { weekNumber: "asc" },
    select: { id: true, weekNumber: true },
  });

  const weekById = new Map(weeks.map((week) => [week.id, week.weekNumber]));

  const playerStats = await prisma.playerWeekStat.findMany({
    where: {
      weekId: { in: weeks.map((week) => week.id) },
      rankableEntry: { position: input.position },
      rankableEntryId: { not: null },
    },
    include: {
      rankableEntry: true,
      week: true,
    },
  });

  const contestEntries = await prisma.contestEntry.findMany({
    where: {
      contest: {
        seasonId: input.seasonId,
        position: input.position,
        weekId: { in: weeks.map((week) => week.id) },
      },
    },
    select: {
      rankableEntryId: true,
      weekTeam: true,
      actualRank: true,
      contest: { select: { weekId: true } },
    },
  });

  const actualRankByKey = new Map<string, number | null>();
  for (const entry of contestEntries) {
    actualRankByKey.set(
      `${entry.contest.weekId}:${entry.rankableEntryId}`,
      entry.actualRank,
    );
  }

  return {
    weekNumbers: weeks.map((week) => week.weekNumber),
    appearances: playerStats
      .filter(
        (
          row,
        ): row is typeof row & {
          rankableEntryId: string;
          rankableEntry: NonNullable<(typeof row)["rankableEntry"]>;
        } => Boolean(row.rankableEntryId && row.rankableEntry),
      )
      .map((row) => ({
        rankableEntryId: row.rankableEntryId,
        name: row.rankableEntry.name,
        team: row.rankableEntry.team,
        position: input.position,
        weekNumber: weekById.get(row.weekId) ?? row.week.weekNumber,
        actualRank:
          row.leagueActualRank ??
          actualRankByKey.get(`${row.weekId}:${row.rankableEntryId}`) ??
          null,
        fantasyPoints: row.fantasyPoints,
        receptions: row.receptions,
        rushingYards: row.rushingYards,
        receivingYards: row.receivingYards,
        passingYards: row.passingYards,
        passingTds: row.passingTds,
        interceptions: row.interceptions,
        rushingTds: row.rushingTds,
        receivingTds: row.receivingTds,
      })),
  };
}

export async function getPlayerResearchForContest(input: {
  seasonId: string;
  position: ContestPosition;
  window: PlayerResearchWindow;
  includeTest?: boolean;
}): Promise<PlayerResearchStatLine[]> {
  const { weekNumbers, appearances } = await loadSeasonResearchAppearances({
    seasonId: input.seasonId,
    position: input.position,
    includeTest: input.includeTest,
  });

  return aggregatePlayerResearchStats(
    appearances,
    input.window,
    weekNumbers,
  );
}

export async function getPlayerResearchMapForContest(input: {
  seasonId: string;
  position: ContestPosition;
  window: PlayerResearchWindow;
}): Promise<Map<string, PlayerResearchStatLine>> {
  const rows = await getPlayerResearchForContest(input);
  return new Map(rows.map((row) => [row.rankableEntryId, row]));
}

export function sortResearchForPicker(
  rows: PlayerResearchStatLine[],
  sortKey: "name" | "team" | "fantasyPointsPerGame" | "averageFinish" = "name",
) {
  if (sortKey === "name") {
    return sortPlayerResearchStats(rows, "name", "asc");
  }
  if (sortKey === "team") {
    return sortPlayerResearchStats(rows, "team", "asc");
  }
  return sortPlayerResearchStats(rows, sortKey, "desc");
}
