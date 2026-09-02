import { prisma } from "@/lib/db";
import type { NflGameStatus } from "@/lib/generated/prisma/client";
import { logProviderFailure, logServerEvent } from "@/lib/log";
import {
  ImportValidationError,
  validateWeeklyImportBundle,
} from "@/lib/nfl/import-validation";
import { createNflDataProvider } from "@/lib/providers/nfl";
import type {
  NflDataProvider,
  WeeklyEligibleBundle,
} from "@/lib/providers/nfl/types";

export type ImportCounts = {
  gamesCreated: number;
  gamesUpdated: number;
  gamesUnchanged: number;
  playersCreated: number;
  playersUpdated: number;
  playersUnchanged: number;
  defensesCreated: number;
  defensesUpdated: number;
  defensesUnchanged: number;
};

export type ImportPreview = {
  provider: string;
  seasonYear: number;
  weekNumber: number;
  bundle: WeeklyEligibleBundle;
  estimated: ImportCounts;
  duplicateExternalIds: string[];
  validation: ReturnType<typeof validateWeeklyImportBundle>;
};

function emptyCounts(): ImportCounts {
  return {
    gamesCreated: 0,
    gamesUpdated: 0,
    gamesUnchanged: 0,
    playersCreated: 0,
    playersUpdated: 0,
    playersUnchanged: 0,
    defensesCreated: 0,
    defensesUpdated: 0,
    defensesUnchanged: 0,
  };
}

function changedPlayer(
  existing: {
    name: string;
    shortName: string;
    team: string;
    position: string;
    headshotUrl: string | null;
    active: boolean;
    availability: string;
  },
  next: {
    name: string;
    shortName: string;
    team: string;
    position: string;
    headshotUrl: string | null;
    active: boolean;
  },
) {
  return (
    existing.name !== next.name ||
    existing.shortName !== next.shortName ||
    existing.team !== next.team ||
    existing.position !== next.position ||
    existing.headshotUrl !== next.headshotUrl ||
    existing.active !== next.active
  );
}

export function findDuplicateExternalIds(
  ids: string[],
): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}

export async function previewWeeklyImport(input: {
  seasonYear: number;
  weekNumber: number;
  provider?: NflDataProvider;
}): Promise<ImportPreview> {
  const provider = input.provider ?? createNflDataProvider();
  const bundle = await provider.getWeeklyEligiblePlayers(
    input.seasonYear,
    input.weekNumber,
  );

  const estimated = emptyCounts();
  const gameIds = bundle.games.map((g) => g.externalId);
  const playerIds = bundle.players.map((p) => p.externalId);
  const defenseIds = bundle.defenses.map((d) => d.externalId);

  for (const game of bundle.games) {
    const existing = await prisma.nflGame.findUnique({
      where: {
        provider_externalId: {
          provider: provider.name,
          externalId: game.externalId,
        },
      },
    });
    if (!existing) estimated.gamesCreated += 1;
    else if (
      existing.homeTeam !== game.homeTeam ||
      existing.awayTeam !== game.awayTeam ||
      existing.startsAt.getTime() !== game.startsAt.getTime() ||
      existing.status !== game.status
    ) {
      estimated.gamesUpdated += 1;
    } else {
      estimated.gamesUnchanged += 1;
    }
  }

  for (const player of bundle.players) {
    const existing = await prisma.rankableEntry.findUnique({
      where: {
        provider_externalId: {
          provider: provider.name,
          externalId: player.externalId,
        },
      },
    });
    if (!existing) estimated.playersCreated += 1;
    else if (
      changedPlayer(existing, {
        name: player.name,
        shortName: player.shortName,
        team: player.team,
        position: player.position,
        headshotUrl: player.headshotUrl,
        active: player.active,
      })
    ) {
      estimated.playersUpdated += 1;
    } else {
      estimated.playersUnchanged += 1;
    }
  }

  for (const defense of bundle.defenses) {
    const existing = await prisma.rankableEntry.findUnique({
      where: {
        provider_externalId: {
          provider: provider.name,
          externalId: defense.externalId,
        },
      },
    });
    if (!existing) estimated.defensesCreated += 1;
    else if (
      existing.name !== defense.name ||
      existing.team !== defense.team ||
      existing.active !== defense.active
    ) {
      estimated.defensesUpdated += 1;
    } else {
      estimated.defensesUnchanged += 1;
    }
  }

  const validation = validateWeeklyImportBundle(bundle, {
    seasonYear: input.seasonYear,
    weekNumber: input.weekNumber,
  });

  return {
    provider: provider.name,
    seasonYear: input.seasonYear,
    weekNumber: input.weekNumber,
    bundle,
    estimated,
    duplicateExternalIds: findDuplicateExternalIds([
      ...gameIds,
      ...playerIds,
      ...defenseIds,
    ]),
    validation,
  };
}

export async function commitWeeklyImport(input: {
  seasonId: string;
  weekId: string;
  seasonYear: number;
  weekNumber: number;
  provider?: NflDataProvider;
}): Promise<ImportCounts> {
  const provider = input.provider ?? createNflDataProvider();
  let bundle: WeeklyEligibleBundle;
  try {
    bundle = await provider.getWeeklyEligiblePlayers(
      input.seasonYear,
      input.weekNumber,
    );
  } catch {
    logProviderFailure(provider.name, "Weekly eligible import failed");
    throw new Error("Provider import failed. Check admin logs — credentials are not shown.");
  }
  const validation = validateWeeklyImportBundle(bundle, {
    seasonYear: input.seasonYear,
    weekNumber: input.weekNumber,
  });
  if (!validation.ok) {
    logServerEvent(
      "import.validation_failed",
      { provider: provider.name, issues: validation.issues.map((item) => item.code) },
      "warn",
    );
    throw new ImportValidationError(validation.issues.filter((item) => item.blocking));
  }
  const counts = emptyCounts();

  const gameIdByExternal = new Map<string, string>();

  for (const game of bundle.games) {
    const existing = await prisma.nflGame.findUnique({
      where: {
        provider_externalId: {
          provider: provider.name,
          externalId: game.externalId,
        },
      },
    });

    if (!existing) {
      const created = await prisma.nflGame.create({
        data: {
          provider: provider.name,
          externalId: game.externalId,
          seasonId: input.seasonId,
          weekId: input.weekId,
          seasonYear: game.seasonYear,
          weekNumber: game.weekNumber,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          startsAt: game.startsAt,
          status: game.status as NflGameStatus,
        },
      });
      gameIdByExternal.set(game.externalId, created.id);
      counts.gamesCreated += 1;
    } else {
      const dirty =
        existing.homeTeam !== game.homeTeam ||
        existing.awayTeam !== game.awayTeam ||
        existing.startsAt.getTime() !== game.startsAt.getTime() ||
        existing.status !== game.status ||
        existing.weekId !== input.weekId;

      if (dirty) {
        await prisma.nflGame.update({
          where: { id: existing.id },
          data: {
            seasonId: input.seasonId,
            weekId: input.weekId,
            seasonYear: game.seasonYear,
            weekNumber: game.weekNumber,
            homeTeam: game.homeTeam,
            awayTeam: game.awayTeam,
            startsAt: game.startsAt,
            status: game.status as NflGameStatus,
          },
        });
        counts.gamesUpdated += 1;
      } else {
        counts.gamesUnchanged += 1;
      }
      gameIdByExternal.set(game.externalId, existing.id);
    }
  }

  async function upsertRankable(entry: {
    externalId: string;
    type: "PLAYER" | "DEFENSE";
    name: string;
    shortName: string;
    team: string;
    position: "QB" | "RB" | "WR" | "TE" | "DEF";
    headshotUrl: string | null;
    active: boolean;
    opponent: string;
    gameStartsAt: Date;
    gameExternalId: string;
  }) {
    const gameId = gameIdByExternal.get(entry.gameExternalId) ?? null;
    const existing = await prisma.rankableEntry.findUnique({
      where: {
        provider_externalId: {
          provider: provider.name,
          externalId: entry.externalId,
        },
      },
    });

    const data = {
      provider: provider.name,
      externalId: entry.externalId,
      type: entry.type,
      name: entry.name,
      shortName: entry.shortName,
      team: entry.team,
      position: entry.position,
      headshotUrl: entry.headshotUrl,
      active: entry.active,
      opponent: entry.opponent,
      gameStartsAt: entry.gameStartsAt,
      gameId,
      availability: entry.active ? ("ACTIVE" as const) : ("INACTIVE" as const),
    };

    if (!existing) {
      await prisma.rankableEntry.create({ data });
      return "created" as const;
    }

    const dirty =
      changedPlayer(existing, data) ||
      existing.opponent !== data.opponent ||
      (existing.gameStartsAt?.getTime() ?? 0) !== data.gameStartsAt.getTime() ||
      existing.gameId !== data.gameId;

    if (dirty) {
      await prisma.rankableEntry.update({
        where: { id: existing.id },
        data,
      });
      return "updated" as const;
    }
    return "unchanged" as const;
  }

  for (const player of bundle.players) {
    const result = await upsertRankable({
      externalId: player.externalId,
      type: "PLAYER",
      name: player.name,
      shortName: player.shortName,
      team: player.team,
      position: player.position,
      headshotUrl: player.headshotUrl,
      active: player.active,
      opponent: player.opponent,
      gameStartsAt: player.gameStartsAt,
      gameExternalId: player.gameExternalId,
    });
    if (result === "created") counts.playersCreated += 1;
    else if (result === "updated") counts.playersUpdated += 1;
    else counts.playersUnchanged += 1;
  }

  for (const defense of bundle.defenses) {
    const result = await upsertRankable({
      externalId: defense.externalId,
      type: "DEFENSE",
      name: defense.name,
      shortName: defense.shortName,
      team: defense.team,
      position: "DEF",
      headshotUrl: defense.headshotUrl,
      active: defense.active,
      opponent: defense.opponent,
      gameStartsAt: defense.gameStartsAt,
      gameExternalId: defense.gameExternalId,
    });
    if (result === "created") counts.defensesCreated += 1;
    else if (result === "updated") counts.defensesUpdated += 1;
    else counts.defensesUnchanged += 1;
  }

  const { autoSyncWeeklyEligibilityForWeek } = await import(
    "@/lib/nfl/weekly-auto-sync"
  );
  await autoSyncWeeklyEligibilityForWeek(input.weekId);

  return counts;
}

/** Create/update RankIQ Week from schedule bounds without duplicating. */
export async function syncWeekFromSchedule(input: {
  seasonId: string;
  weekNumber: number;
  seasonYear: number;
  provider?: NflDataProvider;
}) {
  const provider = input.provider ?? createNflDataProvider();
  const games = await provider.getWeekSchedule(
    input.seasonYear,
    input.weekNumber,
  );
  if (games.length === 0) {
    throw new Error("No games returned for that week");
  }

  const starts = games.map((g) => g.startsAt.getTime());
  const startsAt = new Date(Math.min(...starts));
  const endsAt = new Date(Math.max(...starts) + 5 * 60 * 60 * 1000);
  const { computeNflTimingWindows } = await import("@/lib/timing/week-windows");
  const timing = computeNflTimingWindows(startsAt, endsAt);

  return prisma.week.upsert({
    where: {
      seasonId_weekNumber: {
        seasonId: input.seasonId,
        weekNumber: input.weekNumber,
      },
    },
    update: {
      label: `Week ${input.weekNumber}`,
      startsAt,
      endsAt,
      rankingsOpenAt: timing.rankingsOpenAt,
      fullLockAt: timing.fullLockAt,
      revealStartsAt: timing.revealStartsAt,
      publicReleaseAt: timing.publicReleaseAt,
    },
    create: {
      seasonId: input.seasonId,
      weekNumber: input.weekNumber,
      label: `Week ${input.weekNumber}`,
      startsAt,
      endsAt,
      status: "UPCOMING",
      rankingsOpenAt: timing.rankingsOpenAt,
      fullLockAt: timing.fullLockAt,
      revealStartsAt: timing.revealStartsAt,
      publicReleaseAt: timing.publicReleaseAt,
    },
  });
}
