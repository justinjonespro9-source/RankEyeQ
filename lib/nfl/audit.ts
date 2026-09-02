import { prisma } from "@/lib/db";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { resolveNflProviderName } from "@/lib/providers/nfl";

export type PositionAudit = {
  position: ContestPosition;
  importedPlayers: number;
  contestEligible: number;
  inPool: number;
  excluded: number;
  missingTeam: number;
  missingOpponent: number;
  missingKickoff: number;
  duplicateExternalIds: string[];
};

export async function getWeekDataAudit(weekId: string): Promise<{
  provider: string;
  positions: PositionAudit[];
}> {
  const provider = resolveNflProviderName();
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: weekId },
    include: {
      contests: {
        include: {
          entries: {
            include: { rankableEntry: true, game: true },
          },
        },
      },
      games: true,
    },
  });

  const positions: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];
  const result: PositionAudit[] = [];

  for (const position of positions) {
    const imported = await prisma.rankableEntry.findMany({
      where: { provider, position },
    });

    const externalCounts = new Map<string, number>();
    for (const row of imported) {
      externalCounts.set(
        row.externalId,
        (externalCounts.get(row.externalId) ?? 0) + 1,
      );
    }
    const duplicateExternalIds = [...externalCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([id]) => id);

    const contest = week.contests.find((c) => c.position === position);
    const pool = contest?.entries ?? [];
    const activePool = pool.filter((e) => !e.excluded);
    const teamsPlaying = new Set(
      week.games.flatMap((g) => [g.homeTeam, g.awayTeam]),
    );

    result.push({
      position,
      importedPlayers: imported.length,
      contestEligible: imported.filter(
        (row) => row.active && teamsPlaying.has(row.team),
      ).length,
      inPool: activePool.length,
      excluded: pool.filter((e) => e.excluded).length,
      missingTeam: imported.filter((row) => !row.team).length,
      missingOpponent: activePool.filter(
        (row) =>
          !row.rankableEntry.opponent ||
          row.rankableEntry.opponent === "TBD",
      ).length,
      missingKickoff: activePool.filter(
        (row) => !row.game?.startsAt && !row.rankableEntry.gameStartsAt,
      ).length,
      duplicateExternalIds,
    });
  }

  return { provider, positions: result };
}
