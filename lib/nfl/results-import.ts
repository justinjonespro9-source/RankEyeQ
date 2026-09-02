import { prisma } from "@/lib/db";
import type { NflGameStatus } from "@/lib/generated/prisma/client";
import { DEFAULT_FANTASY_SCORING_VERSION } from "@/lib/fantasy/scoring-config";
import {
  scoreWeeklyDefenseFantasy,
  scoreWeeklyPlayerFantasy,
} from "@/lib/fantasy/shared-engine";
import { logProviderFailure, logServerEvent } from "@/lib/log";
import {
  ImportValidationError,
  validateProviderWeekResults,
} from "@/lib/nfl/import-validation";
import { createNflDataProvider } from "@/lib/providers/nfl";
import type {
  NflDataProvider,
  ProviderWeekResults,
} from "@/lib/providers/nfl/types";

export type ResultsImportPreview = {
  provider: string;
  scoringVersion: string;
  seasonYear: number;
  weekNumber: number;
  playerMatched: number;
  playerUnmatched: number;
  defenseMatched: number;
  defenseUnmatched: number;
  provisionalCount: number;
  zeroPointCount: number;
  sample: Array<{
    kind: "player" | "defense";
    name: string;
    team: string;
    fantasyPoints: number;
    matched: boolean;
    isProvisional: boolean;
    isZero: boolean;
  }>;
  unmatched: ProviderWeekResults["unmatched"];
};

export type ResultsImportCounts = {
  playersCreated: number;
  playersUpdated: number;
  defensesCreated: number;
  defensesUpdated: number;
  gamesUpdated: number;
};

async function loadWeekResults(
  seasonYear: number,
  weekNumber: number,
  provider: NflDataProvider,
): Promise<ProviderWeekResults> {
  if (!provider.getWeekResults) {
    throw new Error(
      `Provider "${provider.name}" does not support weekly results`,
    );
  }
  return provider.getWeekResults(seasonYear, weekNumber);
}

export async function previewWeekResults(input: {
  weekId: string;
  provider?: NflDataProvider;
}): Promise<ResultsImportPreview> {
  const provider = input.provider ?? createNflDataProvider();
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: input.weekId },
    include: { season: true },
  });

  const results = await loadWeekResults(
    week.season.year,
    week.weekNumber,
    provider,
  );

  const scoringVersion =
    week.fantasyScoringVersion || week.season.fantasyScoringVersion || DEFAULT_FANTASY_SCORING_VERSION;
  const unmatched: ProviderWeekResults["unmatched"] = [...results.unmatched];
  const sample: ResultsImportPreview["sample"] = [];

  let playerMatched = 0;
  let playerUnmatched = 0;
  let provisionalCount = 0;
  let zeroPointCount = 0;

  for (const row of results.playerStats) {
    const entry = await prisma.rankableEntry.findUnique({
      where: {
        provider_externalId: {
          provider: provider.name,
          externalId: row.externalPlayerId,
        },
      },
    });
    const points = scoreWeeklyPlayerFantasy(row, scoringVersion).fantasyPoints;
    const isZero = points === 0;
    if (!row.isGameFinal) provisionalCount += 1;
    if (isZero) zeroPointCount += 1;
    if (entry) {
      playerMatched += 1;
      if (sample.length < 12) {
        sample.push({
          kind: "player",
          name: entry.name,
          team: entry.team,
          fantasyPoints: points,
          matched: true,
          isProvisional: !row.isGameFinal,
          isZero,
        });
      }
    } else {
      playerUnmatched += 1;
      unmatched.push({
        kind: "player",
        externalId: row.externalPlayerId,
        detail: row.team ?? undefined,
      });
    }
  }

  let defenseMatched = 0;
  let defenseUnmatched = 0;
  for (const row of results.defenseStats) {
    const entry =
      (await prisma.rankableEntry.findUnique({
        where: {
          provider_externalId: {
            provider: provider.name,
            externalId: row.externalId,
          },
        },
      })) ??
      (await prisma.rankableEntry.findFirst({
        where: {
          provider: provider.name,
          position: "DEF",
          team: row.team,
        },
      }));
    const points = scoreWeeklyDefenseFantasy(row, scoringVersion).fantasyPoints;
    const isZero = points === 0;
    if (!row.isGameFinal) provisionalCount += 1;
    if (isZero) zeroPointCount += 1;
    if (entry) {
      defenseMatched += 1;
      if (sample.length < 16) {
        sample.push({
          kind: "defense",
          name: entry.name,
          team: entry.team,
          fantasyPoints: points,
          matched: true,
          isProvisional: !row.isGameFinal,
          isZero,
        });
      }
    } else {
      defenseUnmatched += 1;
      unmatched.push({
        kind: "defense",
        externalId: row.externalId,
        detail: row.team,
      });
    }
  }

  return {
    provider: provider.name,
    scoringVersion,
    seasonYear: week.season.year,
    weekNumber: week.weekNumber,
    playerMatched,
    playerUnmatched,
    defenseMatched,
    defenseUnmatched,
    provisionalCount,
    zeroPointCount,
    sample,
    unmatched,
  };
}

export async function commitWeekResults(input: {
  weekId: string;
  provider?: NflDataProvider;
}): Promise<ResultsImportCounts> {
  const provider = input.provider ?? createNflDataProvider();
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: input.weekId },
    include: { season: true },
  });
  const scoringVersion =
    week.fantasyScoringVersion || week.season.fantasyScoringVersion || DEFAULT_FANTASY_SCORING_VERSION;
  let results;
  try {
    results = await loadWeekResults(
      week.season.year,
      week.weekNumber,
      provider,
    );
  } catch {
    logProviderFailure(provider.name, "Week results import failed");
    throw new Error("Provider results import failed. Credentials are not shown.");
  }
  const validation = validateProviderWeekResults(results, {
    requireFinal: week.status === "LOCKED" || week.status === "COMPLETE",
  });
  if (!validation.ok) {
    logServerEvent(
      "results.validation_failed",
      { weekId: input.weekId, issues: validation.issues.map((item) => item.code) },
      "warn",
    );
    throw new ImportValidationError(validation.issues.filter((item) => item.blocking));
  }

  const counts: ResultsImportCounts = {
    playersCreated: 0,
    playersUpdated: 0,
    defensesCreated: 0,
    defensesUpdated: 0,
    gamesUpdated: 0,
  };

  const gameIdByExternal = new Map<string, string>();
  for (const game of results.games) {
    const existing = await prisma.nflGame.findUnique({
      where: {
        provider_externalId: {
          provider: provider.name,
          externalId: game.externalId,
        },
      },
    });
    if (existing) {
      if (existing.status !== game.status) {
        await prisma.nflGame.update({
          where: { id: existing.id },
          data: { status: game.status as NflGameStatus },
        });
        counts.gamesUpdated += 1;
      }
      gameIdByExternal.set(game.externalId, existing.id);
    } else {
      const created = await prisma.nflGame.create({
        data: {
          provider: provider.name,
          externalId: game.externalId,
          seasonId: week.seasonId,
          weekId: week.id,
          seasonYear: game.seasonYear,
          weekNumber: game.weekNumber,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          startsAt: game.startsAt,
          status: game.status as NflGameStatus,
        },
      });
      gameIdByExternal.set(game.externalId, created.id);
      counts.gamesUpdated += 1;
    }
  }

  for (const row of results.playerStats) {
    const entry = await prisma.rankableEntry.findUnique({
      where: {
        provider_externalId: {
          provider: provider.name,
          externalId: row.externalPlayerId,
        },
      },
    });
    const fantasyPoints = scoreWeeklyPlayerFantasy(row, scoringVersion).fantasyPoints;
    const gameId = row.gameExternalId
      ? (gameIdByExternal.get(row.gameExternalId) ?? null)
      : null;

    const data = {
      provider: provider.name,
      weekId: week.id,
      rankableEntryId: entry?.id ?? null,
      gameId,
      externalPlayerId: row.externalPlayerId,
      scoringVersion,
      passingYards: row.passingYards,
      passingTds: row.passingTds,
      interceptions: row.interceptions,
      rushingYards: row.rushingYards,
      rushingTds: row.rushingTds,
      receptions: row.receptions,
      receivingYards: row.receivingYards,
      receivingTds: row.receivingTds,
      twoPointConversions: row.twoPointConversions,
      fumblesLost: row.fumblesLost,
      returnTds: row.returnTds,
      fantasyPoints,
      isProvisional: !row.isGameFinal,
    };

    const existing = await prisma.playerWeekStat.findUnique({
      where: {
        provider_weekId_externalPlayerId: {
          provider: provider.name,
          weekId: week.id,
          externalPlayerId: row.externalPlayerId,
        },
      },
    });

    if (!existing) {
      await prisma.playerWeekStat.create({ data });
      counts.playersCreated += 1;
    } else {
      await prisma.playerWeekStat.update({
        where: { id: existing.id },
        data,
      });
      counts.playersUpdated += 1;
    }

    if (entry) {
      await prisma.contestEntry.updateMany({
        where: {
          rankableEntryId: entry.id,
          contest: { weekId: week.id },
        },
        data: { fantasyPoints },
      });
    }
  }

  for (const row of results.defenseStats) {
    const entry =
      (await prisma.rankableEntry.findUnique({
        where: {
          provider_externalId: {
            provider: provider.name,
            externalId: row.externalId,
          },
        },
      })) ??
      (await prisma.rankableEntry.findFirst({
        where: {
          provider: provider.name,
          position: "DEF",
          team: row.team,
        },
      }));

    const fantasyPoints = scoreWeeklyDefenseFantasy(row, scoringVersion).fantasyPoints;
    const gameId = row.gameExternalId
      ? (gameIdByExternal.get(row.gameExternalId) ?? null)
      : null;

    const data = {
      provider: provider.name,
      weekId: week.id,
      rankableEntryId: entry?.id ?? null,
      gameId,
      team: row.team,
      externalId: row.externalId,
      scoringVersion,
      sacks: row.sacks,
      interceptions: row.interceptions,
      fumbleRecoveries: row.fumbleRecoveries,
      defensiveTds: row.defensiveTds,
      specialTeamsTds: row.specialTeamsTds,
      safeties: row.safeties,
      blockedKicks: row.blockedKicks,
      pointsAllowed: row.pointsAllowed,
      fantasyPoints,
      isProvisional: !row.isGameFinal,
    };

    const existing = await prisma.defenseWeekStat.findUnique({
      where: {
        provider_weekId_team: {
          provider: provider.name,
          weekId: week.id,
          team: row.team,
        },
      },
    });

    if (!existing) {
      await prisma.defenseWeekStat.create({ data });
      counts.defensesCreated += 1;
    } else {
      await prisma.defenseWeekStat.update({
        where: { id: existing.id },
        data,
      });
      counts.defensesUpdated += 1;
    }

    if (entry) {
      await prisma.contestEntry.updateMany({
        where: {
          rankableEntryId: entry.id,
          contest: { weekId: week.id },
        },
        data: { fantasyPoints },
      });
    }
  }

  return counts;
}
