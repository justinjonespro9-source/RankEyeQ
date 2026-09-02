import { prisma } from "@/lib/db";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { isSeasonPlayerEligibleForWeeklyField } from "@/lib/nfl/eligibility-rules";
import { consolidateDefenseSeasonPlayers } from "@/lib/nfl/consolidate-defense-season";
import { validateDefenseFranchiseUniqueness } from "@/lib/nfl/pool-canonical-uniqueness";
import { isProductionWeeklyPoolIdentity } from "@/lib/nfl/pool-source";
import { autoSyncWeeklyEligibilityForWeek } from "@/lib/nfl/weekly-auto-sync";

export type PoolReconciliationPositionReport = {
  position: ContestPosition;
  before: number;
  removed: number;
  final: number;
  reasons: Record<string, number>;
};

export type PoolReconciliationReport = {
  weekId: string;
  weekLabel: string;
  defenseSeason: Awaited<ReturnType<typeof consolidateDefenseSeasonPlayers>>;
  positions: PoolReconciliationPositionReport[];
  defenseValidation: Awaited<ReturnType<typeof validateDefenseFranchiseUniqueness>>;
  spotChecks: Record<string, unknown>;
};

async function countActivePool(weekId: string, position: ContestPosition) {
  const contest = await prisma.rankIQContest.findUnique({
    where: { weekId_position: { weekId, position } },
    include: {
      entries: {
        where: { excluded: false },
        include: { rankableEntry: true },
      },
    },
  });
  return contest?.entries.length ?? 0;
}

async function classifyRemovals(weekId: string, position: ContestPosition) {
  const contest = await prisma.rankIQContest.findUnique({
    where: { weekId_position: { weekId, position } },
    include: {
      entries: {
        where: { excluded: true },
        include: { rankableEntry: true },
      },
    },
  });
  const reasons: Record<string, number> = {};
  for (const entry of contest?.entries ?? []) {
    const reason = entry.inactiveReason ?? "other";
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  return reasons;
}

export async function reconcileWeeklyPoolIntegrity(
  weekId: string,
): Promise<PoolReconciliationReport> {
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: weekId },
    include: { season: true, games: true },
  });

  const positions: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];
  const beforeCounts = Object.fromEntries(
    await Promise.all(
      positions.map(async (position) => [
        position,
        await countActivePool(weekId, position),
      ]),
    ),
  ) as Record<ContestPosition, number>;

  const defenseSeason = await consolidateDefenseSeasonPlayers(week.seasonId);
  const sync = await autoSyncWeeklyEligibilityForWeek(weekId);

  const positionReports: PoolReconciliationPositionReport[] = [];
  for (const position of positions) {
    const before = beforeCounts[position];
    const final = await countActivePool(weekId, position);
    const reasons = await classifyRemovals(weekId, position);
    const pruned = sync.byPosition[position]?.pruned ?? Math.max(0, before - final);
    positionReports.push({
      position,
      before,
      removed: pruned,
      final,
      reasons,
    });
  }

  const defenseValidation = await validateDefenseFranchiseUniqueness(weekId);

  const spotTeams = ["MIN", "NE", "PHI", "ATL", "HOU"];
  const spotChecks: Record<string, unknown> = {};
  for (const team of spotTeams) {
    const players = await prisma.contestEntry.findMany({
      where: {
        excluded: false,
        contest: { weekId },
        OR: [{ weekTeam: team }, { rankableEntry: { team } }],
      },
      include: { rankableEntry: true, contest: true },
    });
    spotChecks[team] = {
      activeEntries: players.length,
      def: players.filter((row) => row.contest.position === "DEF").length,
      identities: players.map((row) => ({
        position: row.contest.position,
        name: row.rankableEntry.name,
        provider: row.rankableEntry.provider,
        externalId: row.rankableEntry.externalId,
      })),
    };
  }

  return {
    weekId,
    weekLabel: week.label,
    defenseSeason,
    positions: positionReports,
    defenseValidation,
    spotChecks,
  };
}

export async function auditWeeklyPoolInflation(weekId: string) {
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: weekId },
    include: { season: true, games: true },
  });

  const scheduledTeams = new Set<string>();
  for (const game of week.games) {
    scheduledTeams.add(game.homeTeam);
    scheduledTeams.add(game.awayTeam);
  }

  const positions: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];
  const rows = [];

  for (const position of positions) {
    const contest = await prisma.rankIQContest.findUnique({
      where: { weekId_position: { weekId, position } },
      include: {
        entries: {
          where: { excluded: false },
          include: { rankableEntry: true },
        },
      },
    });

    const seasonPlayers = await prisma.seasonPlayer.findMany({
      where: {
        seasonId: week.seasonId,
        position,
        ...(scheduledTeams.size > 0
          ? { team: { in: [...scheduledTeams] } }
          : {}),
      },
      include: { rankableEntry: true },
    });

    const eligibleIds = new Set(
      seasonPlayers
        .filter((row) => isSeasonPlayerEligibleForWeeklyField(row))
        .map((row) => row.rankableEntryId),
    );

    for (const entry of contest?.entries ?? []) {
      const rankable = entry.rankableEntry;
      const inEligibleSeason = eligibleIds.has(entry.rankableEntryId);
      rows.push({
        position,
        name: rankable.name,
        team: entry.weekTeam ?? rankable.team,
        provider: rankable.provider,
        externalId: rankable.externalId,
        activeMaster: rankable.active,
        inEligibleSeason,
        productionIdentity: isProductionWeeklyPoolIdentity({
          provider: rankable.provider,
          externalId: rankable.externalId,
          position: rankable.position,
          type: rankable.type,
          team: rankable.team,
          active: rankable.active,
        }),
        inactiveReason: entry.inactiveReason,
      });
    }
  }

  return rows;
}
