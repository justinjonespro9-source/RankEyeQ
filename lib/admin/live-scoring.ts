import { prisma } from "@/lib/db";
import type { DefenseStatLine } from "@/lib/fantasy/defense-scoring";
import type { PlayerStatLine } from "@/lib/fantasy/player-scoring";
import { resolveFantasyScoringVersion } from "@/lib/fantasy/shared-engine";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import {
  calculateDefenseLiveFantasyPoints,
  calculatePlayerLiveFantasyPoints,
  LIVE_MANUAL_PROVIDER,
  type LiveScoringEntryRow,
  type LiveScoringGameSummary,
} from "@/lib/admin/live-scoring-shared";

export {
  calculateDefenseLiveFantasyPoints,
  calculatePlayerLiveFantasyPoints,
  EMPTY_DEFENSE,
  EMPTY_PLAYER,
  LIVE_MANUAL_PROVIDER,
  type LiveDefenseStatsInput,
  type LivePlayerStatsInput,
  type LiveScoringEntryRow,
  type LiveScoringGameSummary,
} from "@/lib/admin/live-scoring-shared";

function weekScoringVersion(week: {
  fantasyScoringVersion: string | null;
  season: { fantasyScoringVersion: string | null };
}) {
  return resolveFantasyScoringVersion({
    weekVersion: week.fantasyScoringVersion,
    seasonVersion: week.season.fantasyScoringVersion,
  });
}

async function isLockedByFinalOfficial(input: {
  weekId: string;
  rankableEntryId: string;
  actualRank: number | null;
  contestStatus: string;
}) {
  if (input.actualRank != null) return true;
  if (input.contestStatus === "FINAL" || input.contestStatus === "ARCHIVED") {
    return true;
  }
  const [playerFinal, defenseFinal] = await Promise.all([
    prisma.playerWeekStat.findFirst({
      where: {
        weekId: input.weekId,
        rankableEntryId: input.rankableEntryId,
        isProvisional: false,
      },
      select: { id: true },
    }),
    prisma.defenseWeekStat.findFirst({
      where: {
        weekId: input.weekId,
        rankableEntryId: input.rankableEntryId,
        isProvisional: false,
      },
      select: { id: true },
    }),
  ]);
  return Boolean(playerFinal || defenseFinal);
}

export async function listLiveScoringGames(
  weekId: string,
): Promise<LiveScoringGameSummary[]> {
  const games = await prisma.nflGame.findMany({
    where: { weekId },
    orderBy: [{ startsAt: "asc" }, { awayTeam: "asc" }],
  });

  const entries = await prisma.contestEntry.findMany({
    where: {
      excluded: false,
      contest: { weekId },
    },
    select: {
      gameId: true,
      fantasyPoints: true,
      rankableEntry: { select: { team: true, gameId: true } },
    },
  });

  return games.map((game) => {
    const teams = new Set([game.awayTeam, game.homeTeam]);
    const gameEntries = entries.filter(
      (entry) =>
        entry.gameId === game.id ||
        entry.rankableEntry.gameId === game.id ||
        (entry.gameId == null && teams.has(entry.rankableEntry.team)),
    );
    return {
      id: game.id,
      awayTeam: game.awayTeam,
      homeTeam: game.homeTeam,
      startsAt: game.startsAt,
      status: game.status,
      scoredEntries: gameEntries.filter((entry) => entry.fantasyPoints != null)
        .length,
      totalEntries: gameEntries.length,
    };
  });
}

export async function listLiveScoringEntriesForGame(input: {
  weekId: string;
  gameId: string;
}): Promise<LiveScoringEntryRow[]> {
  const game = await prisma.nflGame.findFirst({
    where: { id: input.gameId, weekId: input.weekId },
  });
  if (!game) return [];

  const week = await prisma.week.findUniqueOrThrow({
    where: { id: input.weekId },
    include: { season: true },
  });
  const scoringVersion = weekScoringVersion(week);
  const teams = [game.awayTeam, game.homeTeam];

  const entries = await prisma.contestEntry.findMany({
    where: {
      excluded: false,
      contest: { weekId: input.weekId },
      OR: [
        { gameId: game.id },
        {
          gameId: null,
          rankableEntry: {
            OR: [{ gameId: game.id }, { team: { in: teams } }],
          },
        },
      ],
    },
    include: {
      contest: { select: { id: true, position: true, status: true } },
      rankableEntry: true,
      game: true,
    },
  });

  const filtered = entries.filter((entry) => {
    if (entry.gameId === game.id) return true;
    if (entry.rankableEntry.gameId === game.id) return true;
    if (entry.gameId != null) return false;
    return teams.includes(entry.rankableEntry.team);
  });

  const rankableIds = filtered.map((entry) => entry.rankableEntryId);
  const [playerStats, defenseStats] = await Promise.all([
    prisma.playerWeekStat.findMany({
      where: {
        provider: LIVE_MANUAL_PROVIDER,
        weekId: input.weekId,
        rankableEntryId: { in: rankableIds },
        isProvisional: true,
      },
    }),
    prisma.defenseWeekStat.findMany({
      where: {
        provider: LIVE_MANUAL_PROVIDER,
        weekId: input.weekId,
        rankableEntryId: { in: rankableIds },
        isProvisional: true,
      },
    }),
  ]);

  const playerByRankable = new Map(
    playerStats.map((row) => [row.rankableEntryId!, row]),
  );
  const defenseByRankable = new Map(
    defenseStats.map((row) => [row.rankableEntryId!, row]),
  );

  const rows: LiveScoringEntryRow[] = [];
  for (const entry of filtered) {
    const lockedByFinal = await isLockedByFinalOfficial({
      weekId: input.weekId,
      rankableEntryId: entry.rankableEntryId,
      actualRank: entry.actualRank,
      contestStatus: entry.contest.status,
    });
    const isDef = entry.contest.position === "DEF";
    const playerRow = playerByRankable.get(entry.rankableEntryId) ?? null;
    const defenseRow = defenseByRankable.get(entry.rankableEntryId) ?? null;
    const hasLiveStatRecord = isDef ? Boolean(defenseRow) : Boolean(playerRow);

    rows.push({
      contestEntryId: entry.id,
      contestId: entry.contest.id,
      contestPosition: entry.contest.position,
      contestStatus: entry.contest.status,
      rankableEntryId: entry.rankableEntryId,
      externalId: entry.rankableEntry.externalId,
      name: entry.rankableEntry.name,
      team: entry.rankableEntry.team,
      opponent: entry.rankableEntry.opponent,
      position: entry.contest.position,
      fantasyPoints: entry.fantasyPoints,
      hasLiveStatRecord,
      actualRank: entry.actualRank,
      updatedAt:
        (isDef ? defenseRow?.updatedAt : playerRow?.updatedAt) ??
        entry.updatedAt,
      gameId: entry.gameId ?? entry.rankableEntry.gameId ?? game.id,
      gameStatus: entry.game?.status ?? game.status,
      startsAt: entry.game?.startsAt ?? game.startsAt,
      lockedByFinal,
      scoringVersion,
      playerStats: playerRow
        ? {
            passingYards: playerRow.passingYards,
            passingTds: playerRow.passingTds,
            interceptions: playerRow.interceptions,
            rushingYards: playerRow.rushingYards,
            rushingTds: playerRow.rushingTds,
            receptions: playerRow.receptions,
            receivingYards: playerRow.receivingYards,
            receivingTds: playerRow.receivingTds,
            twoPointConversions: playerRow.twoPointConversions,
            fumblesLost: playerRow.fumblesLost,
            returnTds: playerRow.returnTds,
          }
        : null,
      defenseStats: defenseRow
        ? {
            sacks: defenseRow.sacks,
            interceptions: defenseRow.interceptions,
            fumbleRecoveries: defenseRow.fumbleRecoveries,
            defensiveTds: defenseRow.defensiveTds,
            specialTeamsTds: defenseRow.specialTeamsTds,
            safeties: defenseRow.safeties,
            blockedKicks: defenseRow.blockedKicks,
            pointsAllowed: defenseRow.pointsAllowed,
          }
        : null,
    });
  }

  const positionOrder: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];
  rows.sort((a, b) => {
    const pos =
      positionOrder.indexOf(a.position) - positionOrder.indexOf(b.position);
    if (pos !== 0) return pos;
    return a.name.localeCompare(b.name);
  });

  return rows;
}

function normalizePlayerStats(input: PlayerStatLine): Required<PlayerStatLine> {
  return {
    passingYards: Number(input.passingYards) || 0,
    passingTds: Math.trunc(Number(input.passingTds) || 0),
    interceptions: Math.trunc(Number(input.interceptions) || 0),
    rushingYards: Number(input.rushingYards) || 0,
    rushingTds: Math.trunc(Number(input.rushingTds) || 0),
    receptions: Math.trunc(Number(input.receptions) || 0),
    receivingYards: Number(input.receivingYards) || 0,
    receivingTds: Math.trunc(Number(input.receivingTds) || 0),
    twoPointConversions: Math.trunc(Number(input.twoPointConversions) || 0),
    fumblesLost: Math.trunc(Number(input.fumblesLost) || 0),
    returnTds: Math.trunc(Number(input.returnTds) || 0),
  };
}

function normalizeDefenseStats(
  input: DefenseStatLine,
): Required<DefenseStatLine> {
  return {
    sacks: Number(input.sacks) || 0,
    interceptions: Math.trunc(Number(input.interceptions) || 0),
    fumbleRecoveries: Math.trunc(Number(input.fumbleRecoveries) || 0),
    defensiveTds: Math.trunc(Number(input.defensiveTds) || 0),
    specialTeamsTds: Math.trunc(Number(input.specialTeamsTds) || 0),
    safeties: Math.trunc(Number(input.safeties) || 0),
    blockedKicks: Math.trunc(Number(input.blockedKicks) || 0),
    pointsAllowed: Math.trunc(Number(input.pointsAllowed) || 0),
  };
}

/**
 * Persist live/manual raw stats for one contest entry, score via canonical V2
 * (or week scoring version), sync ContestEntry.fantasyPoints.
 * Does not grade submissions or finalize contests.
 */
export async function saveLivePlayerStats(input: {
  contestEntryId: string;
  stats: PlayerStatLine;
  adminUserId: string;
}): Promise<{
  contestEntryId: string;
  fantasyPoints: number;
  skipped: boolean;
  reason?: string;
  updatedAt: Date;
}> {
  void input.adminUserId;
  const entry = await prisma.contestEntry.findUniqueOrThrow({
    where: { id: input.contestEntryId },
    include: {
      contest: { include: { week: { include: { season: true } } } },
      rankableEntry: true,
      game: true,
    },
  });

  if (entry.contest.position === "DEF") {
    return {
      contestEntryId: entry.id,
      fantasyPoints: entry.fantasyPoints ?? 0,
      skipped: true,
      reason: "Use defense stat save for DEF entries",
      updatedAt: entry.updatedAt,
    };
  }

  const lockedByFinal = await isLockedByFinalOfficial({
    weekId: entry.contest.weekId,
    rankableEntryId: entry.rankableEntryId,
    actualRank: entry.actualRank,
    contestStatus: entry.contest.status,
  });
  if (lockedByFinal) {
    return {
      contestEntryId: entry.id,
      fantasyPoints: entry.fantasyPoints ?? 0,
      skipped: true,
      reason: "Locked by final official results",
      updatedAt: entry.updatedAt,
    };
  }

  const week = entry.contest.week;
  const scoringVersion = weekScoringVersion(week);
  const stats = normalizePlayerStats(input.stats);
  const fantasyPoints = calculatePlayerLiveFantasyPoints(stats, scoringVersion);

  await prisma.playerWeekStat.upsert({
    where: {
      provider_weekId_externalPlayerId: {
        provider: LIVE_MANUAL_PROVIDER,
        weekId: week.id,
        externalPlayerId: entry.rankableEntry.externalId,
      },
    },
    update: {
      rankableEntryId: entry.rankableEntryId,
      gameId: entry.gameId,
      scoringVersion,
      ...stats,
      fantasyPoints,
      isProvisional: true,
      leagueActualRank: null,
    },
    create: {
      provider: LIVE_MANUAL_PROVIDER,
      weekId: week.id,
      rankableEntryId: entry.rankableEntryId,
      gameId: entry.gameId,
      externalPlayerId: entry.rankableEntry.externalId,
      scoringVersion,
      ...stats,
      fantasyPoints,
      isProvisional: true,
    },
  });

  const updated = await prisma.contestEntry.update({
    where: { id: entry.id },
    data: {
      fantasyPoints,
      actualRank: entry.actualRank,
    },
  });

  if (entry.gameId && entry.game?.status === "SCHEDULED") {
    await prisma.nflGame.update({
      where: { id: entry.gameId },
      data: { status: "IN_PROGRESS" },
    });
  }

  return {
    contestEntryId: updated.id,
    fantasyPoints,
    skipped: false,
    updatedAt: updated.updatedAt,
  };
}

export async function saveLiveDefenseStats(input: {
  contestEntryId: string;
  stats: DefenseStatLine;
  adminUserId: string;
}): Promise<{
  contestEntryId: string;
  fantasyPoints: number;
  skipped: boolean;
  reason?: string;
  updatedAt: Date;
}> {
  void input.adminUserId;
  const entry = await prisma.contestEntry.findUniqueOrThrow({
    where: { id: input.contestEntryId },
    include: {
      contest: { include: { week: { include: { season: true } } } },
      rankableEntry: true,
      game: true,
    },
  });

  if (entry.contest.position !== "DEF") {
    return {
      contestEntryId: entry.id,
      fantasyPoints: entry.fantasyPoints ?? 0,
      skipped: true,
      reason: "Defense stats only apply to DEF entries",
      updatedAt: entry.updatedAt,
    };
  }

  const lockedByFinal = await isLockedByFinalOfficial({
    weekId: entry.contest.weekId,
    rankableEntryId: entry.rankableEntryId,
    actualRank: entry.actualRank,
    contestStatus: entry.contest.status,
  });
  if (lockedByFinal) {
    return {
      contestEntryId: entry.id,
      fantasyPoints: entry.fantasyPoints ?? 0,
      skipped: true,
      reason: "Locked by final official results",
      updatedAt: entry.updatedAt,
    };
  }

  const week = entry.contest.week;
  const scoringVersion = weekScoringVersion(week);
  const stats = normalizeDefenseStats(input.stats);
  const fantasyPoints = calculateDefenseLiveFantasyPoints(
    stats,
    scoringVersion,
  );

  await prisma.defenseWeekStat.upsert({
    where: {
      provider_weekId_team: {
        provider: LIVE_MANUAL_PROVIDER,
        weekId: week.id,
        team: entry.rankableEntry.team,
      },
    },
    update: {
      rankableEntryId: entry.rankableEntryId,
      gameId: entry.gameId,
      externalId: entry.rankableEntry.externalId,
      scoringVersion,
      ...stats,
      fantasyPoints,
      isProvisional: true,
      leagueActualRank: null,
    },
    create: {
      provider: LIVE_MANUAL_PROVIDER,
      weekId: week.id,
      rankableEntryId: entry.rankableEntryId,
      gameId: entry.gameId,
      team: entry.rankableEntry.team,
      externalId: entry.rankableEntry.externalId,
      scoringVersion,
      ...stats,
      fantasyPoints,
      isProvisional: true,
    },
  });

  const updated = await prisma.contestEntry.update({
    where: { id: entry.id },
    data: {
      fantasyPoints,
      actualRank: entry.actualRank,
    },
  });

  if (entry.gameId && entry.game?.status === "SCHEDULED") {
    await prisma.nflGame.update({
      where: { id: entry.gameId },
      data: { status: "IN_PROGRESS" },
    });
  }

  return {
    contestEntryId: updated.id,
    fantasyPoints,
    skipped: false,
    updatedAt: updated.updatedAt,
  };
}

/** Clear live/manual line: remove provisional week-stat, set ContestEntry points to NULL. */
export async function clearLiveStats(input: {
  contestEntryId: string;
  adminUserId: string;
}): Promise<{
  contestEntryId: string;
  fantasyPoints: null;
  skipped: boolean;
  reason?: string;
}> {
  void input.adminUserId;
  const entry = await prisma.contestEntry.findUniqueOrThrow({
    where: { id: input.contestEntryId },
    include: {
      contest: true,
      rankableEntry: true,
    },
  });

  const lockedByFinal = await isLockedByFinalOfficial({
    weekId: entry.contest.weekId,
    rankableEntryId: entry.rankableEntryId,
    actualRank: entry.actualRank,
    contestStatus: entry.contest.status,
  });
  if (lockedByFinal) {
    return {
      contestEntryId: entry.id,
      fantasyPoints: null,
      skipped: true,
      reason: "Locked by final official results",
    };
  }

  if (entry.contest.position === "DEF") {
    await prisma.defenseWeekStat.deleteMany({
      where: {
        provider: LIVE_MANUAL_PROVIDER,
        weekId: entry.contest.weekId,
        rankableEntryId: entry.rankableEntryId,
        isProvisional: true,
      },
    });
  } else {
    await prisma.playerWeekStat.deleteMany({
      where: {
        provider: LIVE_MANUAL_PROVIDER,
        weekId: entry.contest.weekId,
        rankableEntryId: entry.rankableEntryId,
        isProvisional: true,
      },
    });
  }

  await prisma.contestEntry.update({
    where: { id: entry.id },
    data: {
      fantasyPoints: null,
      actualRank: entry.actualRank,
    },
  });

  return { contestEntryId: entry.id, fantasyPoints: null, skipped: false };
}
