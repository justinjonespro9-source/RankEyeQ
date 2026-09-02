import { prisma } from "@/lib/db";
import { resolveNflProviderName } from "@/lib/providers/nfl";

export type ResultsAudit = {
  provider: string;
  scoringVersion: string;
  scheduledPlayers: number;
  playersWithStats: number;
  zeroPointStatLines: number;
  missingPlayerStats: number;
  unmatchedPlayerStats: number;
  unmatchedDefenseStats: number;
  missingGames: number;
  gamesNotFinal: number;
  defensesWithStats: number;
  missingDefenseStats: number;
  contests: Array<{
    position: string;
    status: string;
    poolSize: number;
    withPoints: number;
    withRanks: number;
    readyToGrade: boolean;
  }>;
};

export async function getWeekResultsAudit(weekId: string): Promise<ResultsAudit> {
  const provider = resolveNflProviderName();
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: weekId },
    include: {
      games: true,
      contests: {
        include: {
          entries: {
            where: { excluded: false },
            include: { rankableEntry: true },
          },
        },
      },
      playerWeekStats: true,
      defenseWeekStats: true,
    },
  });

  const poolEntries = week.contests.flatMap((contest) => contest.entries);
  const offensePool = poolEntries.filter(
    (entry) => entry.rankableEntry.position !== "DEF",
  );
  const defensePool = poolEntries.filter(
    (entry) => entry.rankableEntry.position === "DEF",
  );

  const playerStatsByEntry = new Map(
    week.playerWeekStats
      .filter((row) => row.rankableEntryId)
      .map((row) => [row.rankableEntryId as string, row]),
  );
  const defenseStatsByEntry = new Map(
    week.defenseWeekStats
      .filter((row) => row.rankableEntryId)
      .map((row) => [row.rankableEntryId as string, row]),
  );

  let playersWithStats = 0;
  let zeroPointStatLines = 0;
  let missingPlayerStats = 0;
  for (const entry of offensePool) {
    const stat = playerStatsByEntry.get(entry.rankableEntryId);
    if (!stat) {
      missingPlayerStats += 1;
      continue;
    }
    playersWithStats += 1;
    if (stat.fantasyPoints === 0) zeroPointStatLines += 1;
  }

  let defensesWithStats = 0;
  let missingDefenseStats = 0;
  for (const entry of defensePool) {
    const stat = defenseStatsByEntry.get(entry.rankableEntryId);
    if (!stat) {
      missingDefenseStats += 1;
      continue;
    }
    defensesWithStats += 1;
    if (stat.fantasyPoints === 0) zeroPointStatLines += 1;
  }

  const unmatchedPlayerStats = week.playerWeekStats.filter(
    (row) => !row.rankableEntryId,
  ).length;
  const unmatchedDefenseStats = week.defenseWeekStats.filter(
    (row) => !row.rankableEntryId,
  ).length;

  const contests = week.contests.map((contest) => {
    const withPoints = contest.entries.filter(
      (entry) => entry.fantasyPoints != null,
    ).length;
    const withRanks = contest.entries.filter(
      (entry) => entry.actualRank != null,
    ).length;
    return {
      position: contest.position,
      status: contest.status,
      poolSize: contest.entries.length,
      withPoints,
      withRanks,
      readyToGrade: withRanks >= contest.rankingDepth,
    };
  });

  return {
    provider,
    scoringVersion: week.fantasyScoringVersion,
    scheduledPlayers: offensePool.length,
    playersWithStats,
    zeroPointStatLines,
    missingPlayerStats,
    unmatchedPlayerStats,
    unmatchedDefenseStats,
    missingGames: week.games.length === 0 ? 1 : 0,
    gamesNotFinal: week.games.filter((game) => game.status !== "FINAL").length,
    defensesWithStats,
    missingDefenseStats,
    contests,
  };
}
