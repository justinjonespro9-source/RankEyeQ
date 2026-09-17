import { prisma } from "@/lib/db";

export type OrphanGameReferenceCounts = {
  contestEntries: number;
  rankableEntries: number;
  playerWeekStats: number;
  defenseWeekStats: number;
};

export type OrphanGamePlanRow = {
  id: string;
  provider: string;
  externalId: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
  weekId: string | null;
  references: OrphanGameReferenceCounts;
  protected: boolean;
  action: "delete" | "conflict_preserve";
  reason: string;
};

export type OrphanGameCleanupReport = {
  weekId: string;
  applied: boolean;
  keepExternalIds: string[];
  proposedDeletions: OrphanGamePlanRow[];
  conflicts: OrphanGamePlanRow[];
  deletedIds: string[];
};

async function referenceCountsForGame(
  gameId: string,
): Promise<OrphanGameReferenceCounts> {
  const [contestEntries, rankableEntries, playerWeekStats, defenseWeekStats] =
    await Promise.all([
      prisma.contestEntry.count({ where: { gameId } }),
      prisma.rankableEntry.count({ where: { gameId } }),
      prisma.playerWeekStat.count({ where: { gameId } }),
      prisma.defenseWeekStat.count({ where: { gameId } }),
    ]);
  return {
    contestEntries,
    rankableEntries,
    playerWeekStats,
    defenseWeekStats,
  };
}

function isProtected(refs: OrphanGameReferenceCounts) {
  return (
    refs.contestEntries > 0 ||
    refs.rankableEntries > 0 ||
    refs.playerWeekStats > 0 ||
    refs.defenseWeekStats > 0
  );
}

/**
 * Plan (and optionally apply) deletion of week schedule rows whose externalId
 * is not in the canonical keep set. Never deletes games with ContestEntry,
 * RankableEntry, or week-stat references.
 */
export async function cleanupOrphanNflGames(input: {
  weekId: string;
  keepExternalIds: Iterable<string>;
  apply?: boolean;
}): Promise<OrphanGameCleanupReport> {
  const apply = Boolean(input.apply);
  const keep = new Set(
    [...input.keepExternalIds].map((id) => id.trim()).filter(Boolean),
  );

  const candidates = await prisma.nflGame.findMany({
    where: {
      weekId: input.weekId,
      externalId: { notIn: [...keep] },
    },
    orderBy: [{ startsAt: "asc" }, { externalId: "asc" }],
  });

  const proposedDeletions: OrphanGamePlanRow[] = [];
  const conflicts: OrphanGamePlanRow[] = [];
  const deletedIds: string[] = [];

  for (const game of candidates) {
    const references = await referenceCountsForGame(game.id);
    const protectedGame = isProtected(references);
    const row: OrphanGamePlanRow = {
      id: game.id,
      provider: game.provider,
      externalId: game.externalId,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      kickoffAt: game.startsAt.toISOString(),
      weekId: game.weekId,
      references,
      protected: protectedGame,
      action: protectedGame ? "conflict_preserve" : "delete",
      reason: protectedGame
        ? "Protected references present — operator review required; not deleted."
        : "Unreferenced duplicate/test schedule row — safe to delete.",
    };

    if (protectedGame) {
      conflicts.push(row);
      continue;
    }

    proposedDeletions.push(row);
    if (apply) {
      await prisma.nflGame.delete({ where: { id: game.id } });
      deletedIds.push(game.id);
    }
  }

  return {
    weekId: input.weekId,
    applied: apply,
    keepExternalIds: [...keep].sort(),
    proposedDeletions,
    conflicts,
    deletedIds,
  };
}

export function scheduleKeepExternalIds(input: {
  seasonYear: number;
  weekNumber: number;
  rows: Array<{ awayTeam: string; homeTeam: string }>;
}) {
  return input.rows.map(
    (row) =>
      `manual-${input.seasonYear}-w${input.weekNumber}-${row.awayTeam}-${row.homeTeam}`,
  );
}
