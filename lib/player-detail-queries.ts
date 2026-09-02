import { prisma } from "@/lib/db";
import { aggregatePlayerPerformance } from "@/lib/player-performance";
import { mapContestEntriesToPerformanceSource } from "@/lib/player-performance";

export async function getPlayerDetailById(playerId: string, seasonId?: string) {
  const entry = await prisma.rankableEntry.findUnique({
    where: { id: playerId },
    include: {
      seasonPlayers: {
        where: seasonId ? { seasonId } : undefined,
        include: { season: true },
        orderBy: { season: { year: "desc" } },
        take: 1,
      },
    },
  });

  if (!entry || entry.type !== "PLAYER") return null;

  const season =
    (seasonId
      ? await prisma.season.findUnique({ where: { id: seasonId } })
      : null) ??
    (await prisma.season.findFirst({
      where: { active: true, sport: "NFL" },
      orderBy: { year: "desc" },
    }));

  if (!season) {
    return {
      entry,
      seasonPlayer: entry.seasonPlayers[0] ?? null,
      season: null,
      summary: null,
      weeklyHistory: [],
    };
  }

  const contestEntries = await prisma.contestEntry.findMany({
    where: {
      rankableEntryId: entry.id,
      contest: {
        seasonId: season.id,
        week: { isTest: false },
      },
    },
    include: {
      contest: { include: { week: true } },
    },
    orderBy: [{ contest: { week: { weekNumber: "asc" } } }],
  });

  const source = mapContestEntriesToPerformanceSource(
    contestEntries.map((row) => ({
      rankableEntryId: row.rankableEntryId,
      name: entry.name,
      team: entry.team,
      position: row.contest.position,
      weekId: row.contest.weekId,
      weekLabel: row.contest.week.label,
      weekNumber: row.contest.week.weekNumber,
      contestId: row.contestId,
      weekTeam: row.weekTeam,
      actualRank: row.actualRank,
      fantasyPoints: row.fantasyPoints,
      excluded: row.excluded,
      contestStatus: row.contest.status,
    })),
  );

  const [summary] = aggregatePlayerPerformance(source, {
    position: entry.position,
    qualification: "ALL",
  });

  const weeklyHistory = source
    .filter((row) => row.wasActive && row.actualRank != null)
    .map((row) => ({
      weekLabel: row.weekLabel,
      weekNumber: row.weekNumber,
      team: row.weekTeam ?? row.team,
      fantasyPoints: row.fantasyPoints,
      actualRank: row.actualRank as number,
      consensusRank: row.consensusRank,
    }));

  const seasonPlayer =
    entry.seasonPlayers.find((row) => row.seasonId === season.id) ??
    entry.seasonPlayers[0] ??
    null;

  return {
    entry,
    seasonPlayer,
    season,
    summary: summary ?? null,
    weeklyHistory,
  };
}
