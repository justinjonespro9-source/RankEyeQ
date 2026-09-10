import { prisma } from "@/lib/db";
import type { DefenseStatLine } from "@/lib/fantasy/defense-scoring";
import type { PlayerStatLine } from "@/lib/fantasy/player-scoring";
import { resolveFantasyScoringVersion } from "@/lib/fantasy/shared-engine";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import {
  calculateDefenseLiveFantasyPoints,
  calculatePlayerLiveFantasyPoints,
  LIVE_MANUAL_PROVIDER,
  resolveLiveScoringAdminGameStatus,
  type LiveScoringEntryRow,
  type LiveScoringGameSummary,
} from "@/lib/admin/live-scoring-shared";

export {
  calculateDefenseLiveFantasyPoints,
  calculatePlayerLiveFantasyPoints,
  EMPTY_DEFENSE,
  EMPTY_PLAYER,
  LIVE_MANUAL_PROVIDER,
  resolveLiveScoringAdminGameStatus,
  type LiveDefenseStatsInput,
  type LivePlayerStatsInput,
  type LiveScoringAdminGameStatus,
  type LiveScoringEntryRow,
  type LiveScoringGameSummary,
} from "@/lib/admin/live-scoring-shared";

export class LiveScoringGameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveScoringGameError";
  }
}

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

async function isLockedByGameFinalize(input: {
  weekId: string;
  rankableEntryId: string;
  gameStatsFinalizedAt: Date | null;
}) {
  if (input.gameStatsFinalizedAt != null) return true;
  const [player, defense] = await Promise.all([
    prisma.playerWeekStat.findFirst({
      where: {
        provider: LIVE_MANUAL_PROVIDER,
        weekId: input.weekId,
        rankableEntryId: input.rankableEntryId,
        isProvisional: false,
      },
      select: { id: true },
    }),
    prisma.defenseWeekStat.findFirst({
      where: {
        provider: LIVE_MANUAL_PROVIDER,
        weekId: input.weekId,
        rankableEntryId: input.rankableEntryId,
        isProvisional: false,
      },
      select: { id: true },
    }),
  ]);
  return Boolean(player || defense);
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

  const [playerStats, defenseStats] = await Promise.all([
    prisma.playerWeekStat.findMany({
      where: { provider: LIVE_MANUAL_PROVIDER, weekId },
      select: {
        gameId: true,
        updatedAt: true,
        isProvisional: true,
        rankableEntryId: true,
      },
    }),
    prisma.defenseWeekStat.findMany({
      where: { provider: LIVE_MANUAL_PROVIDER, weekId },
      select: {
        gameId: true,
        updatedAt: true,
        isProvisional: true,
        rankableEntryId: true,
      },
    }),
  ]);

  return games.map((game) => {
    const teams = new Set([game.awayTeam, game.homeTeam]);
    const gameEntries = entries.filter(
      (entry) =>
        entry.gameId === game.id ||
        entry.rankableEntry.gameId === game.id ||
        (entry.gameId == null && teams.has(entry.rankableEntry.team)),
    );
    const scoredEntries = gameEntries.filter(
      (entry) => entry.fantasyPoints != null,
    ).length;
    const gamePlayerStats = playerStats.filter((row) => row.gameId === game.id);
    const gameDefenseStats = defenseStats.filter(
      (row) => row.gameId === game.id,
    );
    const lastStatUpdateAt =
      [...gamePlayerStats, ...gameDefenseStats]
        .map((row) => row.updatedAt)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    return {
      id: game.id,
      awayTeam: game.awayTeam,
      homeTeam: game.homeTeam,
      startsAt: game.startsAt,
      status: game.status,
      adminStatus: resolveLiveScoringAdminGameStatus({
        status: game.status,
        statsFinalizedAt: game.statsFinalizedAt,
        scoredEntries,
      }),
      scoredEntries,
      totalEntries: gameEntries.length,
      playerStatLines: gamePlayerStats.length,
      defenseStatLines: gameDefenseStats.length,
      lastStatUpdateAt,
      statsFinalizedAt: game.statsFinalizedAt,
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
      },
    }),
    prisma.defenseWeekStat.findMany({
      where: {
        provider: LIVE_MANUAL_PROVIDER,
        weekId: input.weekId,
        rankableEntryId: { in: rankableIds },
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
    const lockedByGameFinalize = await isLockedByGameFinalize({
      weekId: input.weekId,
      rankableEntryId: entry.rankableEntryId,
      gameStatsFinalizedAt: game.statsFinalizedAt,
    });
    const isDef = entry.contest.position === "DEF";
    const playerRow = playerByRankable.get(entry.rankableEntryId) ?? null;
    const defenseRow = defenseByRankable.get(entry.rankableEntryId) ?? null;
    const hasLiveStatRecord = isDef ? Boolean(defenseRow) : Boolean(playerRow);
    const statsVerified = isDef
      ? Boolean(defenseRow && !defenseRow.isProvisional)
      : Boolean(playerRow && !playerRow.isProvisional);

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
      statsVerified,
      actualRank: entry.actualRank,
      updatedAt:
        (isDef ? defenseRow?.updatedAt : playerRow?.updatedAt) ??
        entry.updatedAt,
      gameId: entry.gameId ?? entry.rankableEntry.gameId ?? game.id,
      gameStatus: entry.game?.status ?? game.status,
      startsAt: entry.game?.startsAt ?? game.startsAt,
      lockedByFinal,
      lockedByGameFinalize,
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

/**
 * Promote this game's manual provisional WeekStat rows to verified/final
 * (isProvisional=false) and mark NflGame FINAL + statsFinalizedAt.
 * Does NOT grade contests, set actualRank, or write normalized EYEQ.
 */
export async function finalizeLiveGame(input: {
  weekId: string;
  gameId: string;
  adminUserId: string;
}): Promise<{
  gameId: string;
  matchup: string;
  playerStatLines: number;
  defenseStatLines: number;
  statsFinalizedAt: Date;
  contestStatuses: string[];
}> {
  void input.adminUserId;
  const game = await prisma.nflGame.findFirst({
    where: { id: input.gameId, weekId: input.weekId },
  });
  if (!game) {
    throw new LiveScoringGameError("Game not found for this week");
  }
  if (game.statsFinalizedAt != null) {
    throw new LiveScoringGameError("Game stats are already finalized");
  }

  const entries = await listLiveScoringEntriesForGame({
    weekId: input.weekId,
    gameId: input.gameId,
  });
  if (entries.length === 0) {
    throw new LiveScoringGameError("No contest entries for this game");
  }

  const scored = entries.filter((entry) => entry.fantasyPoints != null);
  if (scored.length === 0) {
    throw new LiveScoringGameError(
      "Save at least one live stat line before finalizing this game",
    );
  }

  const missing = scored.filter((entry) => !entry.hasLiveStatRecord);
  if (missing.length > 0) {
    throw new LiveScoringGameError(
      `Missing saved WeekStat rows for: ${missing.map((e) => e.name).join(", ")}`,
    );
  }

  if (
    entries.some(
      (entry) =>
        entry.contestStatus === "FINAL" || entry.contestStatus === "ARCHIVED",
    )
  ) {
    throw new LiveScoringGameError(
      "Weekly contest is already FINAL — use week correction tools instead",
    );
  }

  const playerRankableIds = scored
    .filter((entry) => entry.position !== "DEF")
    .map((entry) => entry.rankableEntryId);
  const defenseRankableIds = scored
    .filter((entry) => entry.position === "DEF")
    .map((entry) => entry.rankableEntryId);

  const [playerUpdate, defenseUpdate] = await prisma.$transaction([
    prisma.playerWeekStat.updateMany({
      where: {
        provider: LIVE_MANUAL_PROVIDER,
        weekId: input.weekId,
        rankableEntryId: { in: playerRankableIds },
      },
      data: { isProvisional: false },
    }),
    prisma.defenseWeekStat.updateMany({
      where: {
        provider: LIVE_MANUAL_PROVIDER,
        weekId: input.weekId,
        rankableEntryId: { in: defenseRankableIds },
      },
      data: { isProvisional: false },
    }),
  ]);

  await prisma.playerWeekStat.updateMany({
    where: {
      provider: LIVE_MANUAL_PROVIDER,
      weekId: input.weekId,
      rankableEntryId: { in: playerRankableIds },
      gameId: null,
    },
    data: { gameId: game.id },
  });
  await prisma.defenseWeekStat.updateMany({
    where: {
      provider: LIVE_MANUAL_PROVIDER,
      weekId: input.weekId,
      rankableEntryId: { in: defenseRankableIds },
      gameId: null,
    },
    data: { gameId: game.id },
  });

  const finalizedAt = new Date();
  await prisma.nflGame.update({
    where: { id: game.id },
    data: {
      status: "FINAL",
      statsFinalizedAt: finalizedAt,
    },
  });

  return {
    gameId: game.id,
    matchup: `${game.awayTeam} @ ${game.homeTeam}`,
    playerStatLines: playerUpdate.count,
    defenseStatLines: defenseUpdate.count,
    statsFinalizedAt: finalizedAt,
    contestStatuses: [...new Set(entries.map((entry) => entry.contestStatus))],
  };
}

/**
 * Reopen a finalized game so Admin can correct official/stat-entry mistakes.
 * Flips manual WeekStat rows back to provisional; clears statsFinalizedAt.
 * Does not delete history rows.
 */
export async function reopenLiveGame(input: {
  weekId: string;
  gameId: string;
  adminUserId: string;
}): Promise<{
  gameId: string;
  matchup: string;
  playerStatLines: number;
  defenseStatLines: number;
}> {
  void input.adminUserId;
  const game = await prisma.nflGame.findFirst({
    where: { id: input.gameId, weekId: input.weekId },
  });
  if (!game) {
    throw new LiveScoringGameError("Game not found for this week");
  }
  if (game.statsFinalizedAt == null && game.status !== "FINAL") {
    throw new LiveScoringGameError("Game is not finalized");
  }

  const entries = await listLiveScoringEntriesForGame({
    weekId: input.weekId,
    gameId: input.gameId,
  });
  if (
    entries.some(
      (entry) =>
        entry.actualRank != null ||
        entry.contestStatus === "FINAL" ||
        entry.contestStatus === "ARCHIVED",
    )
  ) {
    throw new LiveScoringGameError(
      "Cannot reopen — weekly positional finishes or contests are already FINAL",
    );
  }

  const rankableIds = entries.map((entry) => entry.rankableEntryId);
  const [playerUpdate, defenseUpdate] = await Promise.all([
    prisma.playerWeekStat.updateMany({
      where: {
        provider: LIVE_MANUAL_PROVIDER,
        weekId: input.weekId,
        OR: [{ gameId: game.id }, { rankableEntryId: { in: rankableIds } }],
      },
      data: { isProvisional: true },
    }),
    prisma.defenseWeekStat.updateMany({
      where: {
        provider: LIVE_MANUAL_PROVIDER,
        weekId: input.weekId,
        OR: [{ gameId: game.id }, { rankableEntryId: { in: rankableIds } }],
      },
      data: { isProvisional: true },
    }),
  ]);
  await prisma.nflGame.update({
    where: { id: game.id },
    data: {
      status: "IN_PROGRESS",
      statsFinalizedAt: null,
    },
  });

  return {
    gameId: game.id,
    matchup: `${game.awayTeam} @ ${game.homeTeam}`,
    playerStatLines: playerUpdate.count,
    defenseStatLines: defenseUpdate.count,
  };
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
      reason:
        "Locked — game stats finalized or week results are final (reopen game to correct)",
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
      gameId: entry.gameId ?? entry.rankableEntry.gameId,
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
      gameId: entry.gameId ?? entry.rankableEntry.gameId,
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
      reason:
        "Locked — game stats finalized or week results are final (reopen game to correct)",
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
      gameId: entry.gameId ?? entry.rankableEntry.gameId,
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
      gameId: entry.gameId ?? entry.rankableEntry.gameId,
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
