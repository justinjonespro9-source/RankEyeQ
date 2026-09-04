import { prisma } from "@/lib/db";
import { rankingDepthForPosition } from "@/lib/contest-defaults";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { normalizeTeamAbbr } from "@/lib/nfl/manual/parse-common";
import { createNflDataProvider } from "@/lib/providers/nfl";
import type { NflDataProvider } from "@/lib/providers/nfl/types";
import { findGameForTeam, formatOpponentLabel } from "@/lib/providers/nfl/eligibility";

const POSITIONS: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];

export type PoolBuildResult = {
  contestsEnsured: number;
  entriesCreated: number;
  entriesRestored: number;
  entriesSkippedExcluded: number;
  entriesUnchanged: number;
  byPosition: Record<
    ContestPosition,
    { eligible: number; inPool: number; excluded: number }
  >;
};

/**
 * Build five weekly RankIQ contests from imported player/game data.
 * Preserves ContestEntry.excluded and manuallyAdded overrides.
 */
export async function buildRankIqPositionPools(input: {
  weekId: string;
  provider?: NflDataProvider;
}): Promise<PoolBuildResult> {
  const provider = input.provider ?? createNflDataProvider();
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: input.weekId },
    include: { season: true },
  });

  const result: PoolBuildResult = {
    contestsEnsured: 0,
    entriesCreated: 0,
    entriesRestored: 0,
    entriesSkippedExcluded: 0,
    entriesUnchanged: 0,
    byPosition: {
      QB: { eligible: 0, inPool: 0, excluded: 0 },
      RB: { eligible: 0, inPool: 0, excluded: 0 },
      WR: { eligible: 0, inPool: 0, excluded: 0 },
      TE: { eligible: 0, inPool: 0, excluded: 0 },
      DEF: { eligible: 0, inPool: 0, excluded: 0 },
    },
  };

  const games = await prisma.nflGame.findMany({
    where: { weekId: week.id, provider: provider.name },
  });
  const gameByTeam = new Map<string, (typeof games)[number]>();
  for (const game of games) {
    gameByTeam.set(normalizeTeamAbbr(game.homeTeam), game);
    gameByTeam.set(normalizeTeamAbbr(game.awayTeam), game);
  }

  for (const position of POSITIONS) {
    const contest = await prisma.rankIQContest.upsert({
      where: {
        weekId_position: { weekId: week.id, position },
      },
      update: {},
      create: {
        seasonId: week.seasonId,
        weekId: week.id,
        position,
        title: `Week ${week.weekNumber} ${position} Top ${rankingDepthForPosition(position)}`,
        rankingDepth: rankingDepthForPosition(position),
        status: "DRAFT",
      },
    });
    result.contestsEnsured += 1;

    const candidates = await prisma.rankableEntry.findMany({
      where: {
        provider: provider.name,
        position,
        active: true,
      },
      orderBy: { name: "asc" },
    });

    const scheduledCandidates = candidates.filter((entry) =>
      gameByTeam.has(normalizeTeamAbbr(entry.team)),
    );

    result.byPosition[position].eligible = scheduledCandidates.length;

    for (const entry of scheduledCandidates) {
      const game = gameByTeam.get(normalizeTeamAbbr(entry.team));
      if (!game) continue;

      const existing = await prisma.contestEntry.findUnique({
        where: {
          contestId_rankableEntryId: {
            contestId: contest.id,
            rankableEntryId: entry.id,
          },
        },
      });

      if (existing?.excluded) {
        result.entriesSkippedExcluded += 1;
        result.byPosition[position].excluded += 1;
        continue;
      }

      if (!existing) {
        await prisma.contestEntry.create({
          data: {
            contestId: contest.id,
            rankableEntryId: entry.id,
            gameId: game.id,
            weekTeam: entry.team,
            excluded: false,
            manuallyAdded: false,
            suggested: false,
          },
        });
        // Keep denormalized display fields in sync with this week's game.
        await prisma.rankableEntry.update({
          where: { id: entry.id },
          data: {
            gameId: game.id,
            gameStartsAt: game.startsAt,
            opponent: formatOpponentLabel(entry.team, game.homeTeam, game.awayTeam),
          },
        });
        result.entriesCreated += 1;
        result.byPosition[position].inPool += 1;
      } else {
        if (existing.gameId !== game.id) {
          await prisma.contestEntry.update({
            where: { id: existing.id },
            data: { gameId: game.id, weekTeam: entry.team },
          });
          result.entriesRestored += 1;
        } else {
          result.entriesUnchanged += 1;
        }
        await prisma.rankableEntry.update({
          where: { id: entry.id },
          data: {
            gameId: game.id,
            gameStartsAt: game.startsAt,
            opponent: formatOpponentLabel(entry.team, game.homeTeam, game.awayTeam),
          },
        });
        result.byPosition[position].inPool += 1;
      }
    }

    // Count remaining exclusions for audit.
    const excludedCount = await prisma.contestEntry.count({
      where: { contestId: contest.id, excluded: true },
    });
    result.byPosition[position].excluded = excludedCount;
  }

  const { autoSyncWeeklyEligibilityForWeek } = await import(
    "@/lib/nfl/weekly-auto-sync"
  );
  await autoSyncWeeklyEligibilityForWeek(input.weekId);

  return result;
}

export async function setContestEntryExcluded(input: {
  contestEntryId: string;
  excluded: boolean;
}) {
  return prisma.contestEntry.update({
    where: { id: input.contestEntryId },
    data: { excluded: input.excluded },
  });
}

export async function addManualContestEntry(input: {
  contestId: string;
  rankableEntryId: string;
}) {
  const contest = await prisma.rankIQContest.findUniqueOrThrow({
    where: { id: input.contestId },
  });
  const entry = await prisma.rankableEntry.findUniqueOrThrow({
    where: { id: input.rankableEntryId },
  });

  const game =
    (entry.gameId
      ? await prisma.nflGame.findUnique({ where: { id: entry.gameId } })
      : null) ??
    findGameForTeam(
      await prisma.nflGame.findMany({ where: { weekId: contest.weekId } }),
      entry.team,
    );

  if (game) {
    await prisma.rankableEntry.update({
      where: { id: entry.id },
      data: {
        opponent: formatOpponentLabel(entry.team, game.homeTeam, game.awayTeam),
        gameId: game.id,
        gameStartsAt: game.startsAt,
      },
    });
  }

  return prisma.contestEntry.upsert({
    where: {
      contestId_rankableEntryId: {
        contestId: input.contestId,
        rankableEntryId: input.rankableEntryId,
      },
    },
    update: {
      excluded: false,
      manuallyAdded: true,
      gameId: game?.id ?? undefined,
      weekTeam: entry.team,
    },
    create: {
      contestId: input.contestId,
      rankableEntryId: input.rankableEntryId,
      gameId: game?.id ?? null,
      weekTeam: entry.team,
      excluded: false,
      manuallyAdded: true,
    },
  });
}
