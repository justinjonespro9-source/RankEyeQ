import { prisma } from "@/lib/db";
import { rankingDepthForPosition } from "@/lib/contest-defaults";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { enrollSeasonPlayer } from "@/lib/season-players";
import {
  isSeasonPlayerEligibleForWeeklyField,
  shouldPreserveAdminExclusion,
} from "@/lib/nfl/eligibility-rules";
import { isProductionWeeklyPoolIdentity } from "@/lib/nfl/pool-source";
import { isCanonicalDefenseRankableEntry, defenseFranchiseKey } from "@/lib/nfl/defense-identity";
import {
  groupPoolRowsByIdentity,
  pickPreferredPoolRow,
} from "@/lib/nfl/pool-identity";
import { isMutableWeeklyPool } from "@/lib/nfl/weekly-pool-mutable";
import { normalizeTeamAbbr } from "@/lib/nfl/manual/parse-common";
import {
  findGameForTeam,
  formatOpponentLabel,
} from "@/lib/providers/nfl/eligibility";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";

export type WeeklyEligibilityRow = {
  contestEntryId: string | null;
  rankableEntryId: string;
  name: string;
  team: string;
  weekTeam: string | null;
  position: ContestPosition;
  inSeasonUniverse: boolean;
  inWeeklyContest: boolean;
  active: boolean;
  suggested: boolean;
  manuallyAdded: boolean;
  inactiveReason: string | null;
  seedRank: number | null;
  actualRank: number | null;
  fantasyPoints: number | null;
};

export async function getWeeklyEligibilityBoard(input: {
  weekId: string;
  position: ContestPosition;
}) {
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: input.weekId },
    include: { season: true },
  });

  const contest = await prisma.rankIQContest.findUnique({
    where: {
      weekId_position: { weekId: week.id, position: input.position },
    },
    include: {
      entries: { include: { rankableEntry: true, game: true } },
    },
  });

  const seasonPlayers = await prisma.seasonPlayer.findMany({
    where: {
      seasonId: week.seasonId,
      position: input.position,
    },
    include: { rankableEntry: true },
    orderBy: { displayName: "asc" },
  });

  const entryByPlayer = new Map(
    contest?.entries.map((entry) => [entry.rankableEntryId, entry]) ?? [],
  );

  const rows: WeeklyEligibilityRow[] = seasonPlayers.map((player) => {
    const entry = entryByPlayer.get(player.rankableEntryId);
    return {
      contestEntryId: entry?.id ?? null,
      rankableEntryId: player.rankableEntryId,
      name: player.displayName,
      team: player.team,
      weekTeam: entry?.weekTeam ?? player.team,
      position: player.position,
      inSeasonUniverse: true,
      inWeeklyContest: Boolean(entry),
      active: entry ? !entry.excluded : false,
      suggested: entry?.suggested ?? false,
      manuallyAdded: entry?.manuallyAdded ?? false,
      inactiveReason: entry?.inactiveReason ?? null,
      seedRank: entry?.seedRank ?? null,
      actualRank: entry?.actualRank ?? null,
      fantasyPoints: entry?.fantasyPoints ?? null,
    };
  });

  return {
    week,
    contest,
    rows,
    rankingDepth: rankingDepthForPosition(input.position),
  };
}

async function pruneStaleWeeklyPoolEntries(input: {
  contestId: string;
  position: ContestPosition;
  eligibleRankableEntryIds: Set<string>;
  isTestWeek: boolean;
}) {
  const mutable = await isMutableWeeklyPool(
    (
      await prisma.rankIQContest.findUniqueOrThrow({
        where: { id: input.contestId },
        select: { weekId: true },
      })
    ).weekId,
  );
  if (!mutable) {
    return { pruned: 0, reasons: {} as Record<string, number> };
  }

  const activeEntries = await prisma.contestEntry.findMany({
    where: { contestId: input.contestId, excluded: false },
    include: { rankableEntry: true },
  });

  const reasons: Record<string, number> = {};
  let pruned = 0;

  for (const entry of activeEntries) {
    if (shouldPreserveAdminExclusion(entry)) continue;
    if (entry.manuallyAdded) continue;

    const rankable = entry.rankableEntry;
    let reason: string | null = null;

    if (!input.eligibleRankableEntryIds.has(entry.rankableEntryId)) {
      reason = "No longer in eligible season universe";
    } else if (
      !input.isTestWeek &&
      !isProductionWeeklyPoolIdentity({
        provider: rankable.provider,
        externalId: rankable.externalId,
        position: rankable.position,
        type: rankable.type,
        team: rankable.team,
        active: rankable.active,
      })
    ) {
      reason = "Legacy/test identity excluded from production week";
    } else if (!rankable.active) {
      reason = "Inactive master directory entry";
    }

    if (!reason) continue;

    await prisma.contestEntry.update({
      where: { id: entry.id },
      data: {
        excluded: true,
        inactiveReason: reason,
      },
    });
    pruned += 1;
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  }

  return { pruned, reasons };
}

async function pruneMergeCompatiblePoolDuplicates(contestId: string) {
  const mutable = await isMutableWeeklyPool(
    (
      await prisma.rankIQContest.findUniqueOrThrow({
        where: { id: contestId },
        select: { weekId: true },
      })
    ).weekId,
  );
  if (!mutable) {
    return 0;
  }

  const entries = await prisma.contestEntry.findMany({
    where: { contestId, excluded: false },
    include: { rankableEntry: true },
  });

  const rows = entries.map((entry) => ({
    contestEntryId: entry.id,
    rankableEntryId: entry.rankableEntryId,
    manuallyAdded: entry.manuallyAdded,
    meta: {
      name: entry.rankableEntry.name,
      position: entry.rankableEntry.position,
      provider: entry.rankableEntry.provider,
      externalId: entry.rankableEntry.externalId,
      team: entry.weekTeam ?? entry.rankableEntry.team,
      type: entry.rankableEntry.type,
    },
  }));

  const groups = groupPoolRowsByIdentity(rows);
  let pruned = 0;

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const preferred = pickPreferredPoolRow(group);
    for (const row of group) {
      if (row.contestEntryId === preferred.contestEntryId) continue;
      const entry = entries.find((item) => item.id === row.contestEntryId);
      if (!entry || shouldPreserveAdminExclusion(entry) || entry.manuallyAdded) {
        continue;
      }
      await prisma.contestEntry.update({
        where: { id: row.contestEntryId },
        data: {
          excluded: true,
          inactiveReason: "Merged duplicate player identity",
        },
      });
      pruned += 1;
    }
  }

  return pruned;
}

function isDefenseEligibleForWeeklySync(input: {
  rankableEntry: {
    position: ContestPosition;
    type: string;
    provider: string;
    externalId: string;
    team: string;
  };
  team: string;
  isTestWeek: boolean;
  canonicalDefenseTeams: Set<string>;
}) {
  if (isCanonicalDefenseRankableEntry(input.rankableEntry)) {
    return true;
  }

  const franchise = defenseFranchiseKey(input.team);
  const isManualScheduleDefense =
    input.rankableEntry.provider === "manual" &&
    input.rankableEntry.externalId === `manual-def-${franchise}`;

  if (!isManualScheduleDefense) {
    return false;
  }

  if (input.isTestWeek) {
    return true;
  }

  return !input.canonicalDefenseTeams.has(franchise);
}

async function loadCanonicalDefenseTeams(seasonId: string) {
  const rows = await prisma.seasonPlayer.findMany({
    where: {
      seasonId,
      position: "DEF",
      rankableEntry: { provider: NFL_COM_BOOTSTRAP_PROVIDER },
    },
    include: { rankableEntry: true },
  });
  return new Set(rows.map((row) => defenseFranchiseKey(row.team)));
}

/**
 * Sync all roster-eligible season players into the weekly contest field.
 * Eligible players are active (excluded=false) by default — not editorially gated.
 */
export async function syncWeeklyEligibleFieldFromSeason(input: {
  weekId: string;
  position: ContestPosition;
  /** When true, only teams with a scheduled game this week. Default true. */
  scheduledTeamsOnly?: boolean;
}) {
  const scheduledTeamsOnly = input.scheduledTeamsOnly ?? true;

  const week = await prisma.week.findUniqueOrThrow({
    where: { id: input.weekId },
    include: { season: true },
  });

  const mutable = await isMutableWeeklyPool(week.id);
  if (!mutable) {
    return {
      contestId: null as string | null,
      created: 0,
      updated: 0,
      activated: 0,
      skippedIneligible: 0,
      skippedNonProduction: 0,
      pruned: 0,
      pruneReasons: {} as Record<string, number>,
      skippedNonCanonical: 0,
      candidates: 0,
      matchupsStamped: 0,
      skippedImmutable: true as const,
    };
  }

  const contest = await prisma.rankIQContest.upsert({
    where: {
      weekId_position: { weekId: week.id, position: input.position },
    },
    update: {},
    create: {
      seasonId: week.seasonId,
      weekId: week.id,
      position: input.position,
      title: `Week ${week.weekNumber} ${input.position} Top ${rankingDepthForPosition(input.position)}`,
      rankingDepth: rankingDepthForPosition(input.position),
      status: "DRAFT",
    },
  });

  const games = await prisma.nflGame.findMany({ where: { weekId: week.id } });
  const scheduledCanonicalTeams = new Set<string>();
  for (const game of games) {
    scheduledCanonicalTeams.add(normalizeTeamAbbr(game.homeTeam));
    scheduledCanonicalTeams.add(normalizeTeamAbbr(game.awayTeam));
  }

  const seasonPlayersRaw = await prisma.seasonPlayer.findMany({
    where: {
      seasonId: week.seasonId,
      position: input.position,
    },
    include: { rankableEntry: true },
    orderBy: { displayName: "asc" },
  });

  const seasonPlayers =
    scheduledTeamsOnly && scheduledCanonicalTeams.size > 0
      ? seasonPlayersRaw.filter((player) =>
          scheduledCanonicalTeams.has(normalizeTeamAbbr(player.team)),
        )
      : seasonPlayersRaw;

  let created = 0;
  let updated = 0;
  let activated = 0;
  let skippedIneligible = 0;
  let skippedNonCanonical = 0;
  let skippedNonProduction = 0;
  let matchupsStamped = 0;
  const eligibleRankableEntryIds = new Set<string>();
  const canonicalDefenseTeams = await loadCanonicalDefenseTeams(week.seasonId);

  for (const [index, player] of seasonPlayers.entries()) {
    if (
      input.position === "DEF" &&
      !isDefenseEligibleForWeeklySync({
        rankableEntry: player.rankableEntry,
        team: player.team,
        isTestWeek: week.isTest,
        canonicalDefenseTeams,
      })
    ) {
      skippedNonCanonical += 1;
      continue;
    }

    const nflEligible = isSeasonPlayerEligibleForWeeklyField(player);
    if (!nflEligible) {
      skippedIneligible += 1;
      continue;
    }

    if (
      !week.isTest &&
      !isProductionWeeklyPoolIdentity({
        provider: player.rankableEntry.provider,
        externalId: player.rankableEntry.externalId,
        position: player.rankableEntry.position,
        type: player.rankableEntry.type,
        team: player.team,
        active: player.rankableEntry.active,
      })
    ) {
      skippedNonProduction += 1;
      continue;
    }

    eligibleRankableEntryIds.add(player.rankableEntryId);

    const game = findGameForTeam(games, player.team);

    if (game) {
      const opponent = formatOpponentLabel(
        player.team,
        game.homeTeam,
        game.awayTeam,
      );
      const needsStamp =
        player.rankableEntry.opponent !== opponent ||
        player.rankableEntry.gameId !== game.id ||
        (player.rankableEntry.gameStartsAt?.getTime() ?? 0) !==
          game.startsAt.getTime();
      if (needsStamp) {
        await prisma.rankableEntry.update({
          where: { id: player.rankableEntryId },
          data: {
            opponent,
            gameId: game.id,
            gameStartsAt: game.startsAt,
          },
        });
        matchupsStamped += 1;
      }
    }

    const existing = await prisma.contestEntry.findUnique({
      where: {
        contestId_rankableEntryId: {
          contestId: contest.id,
          rankableEntryId: player.rankableEntryId,
        },
      },
    });

    if (existing) {
      if (shouldPreserveAdminExclusion(existing)) {
        await prisma.contestEntry.update({
          where: { id: existing.id },
          data: {
            weekTeam: player.team,
            gameId: game?.id ?? existing.gameId,
            seedRank: index + 1,
          },
        });
        updated += 1;
        continue;
      }

      if (existing.excluded) {
        await prisma.contestEntry.update({
          where: { id: existing.id },
          data: {
            excluded: false,
            suggested: false,
            inactiveReason: null,
            weekTeam: player.team,
            gameId: game?.id ?? existing.gameId,
            seedRank: index + 1,
          },
        });
        activated += 1;
        updated += 1;
        continue;
      }

      await prisma.contestEntry.update({
        where: { id: existing.id },
        data: {
          weekTeam: player.team,
          gameId: game?.id ?? existing.gameId,
          seedRank: index + 1,
        },
      });
      updated += 1;
      continue;
    }

    await prisma.contestEntry.create({
      data: {
        contestId: contest.id,
        rankableEntryId: player.rankableEntryId,
        gameId: game?.id ?? null,
        weekTeam: player.team,
        excluded: false,
        suggested: false,
        manuallyAdded: false,
        seedRank: index + 1,
      },
    });
    created += 1;
  }

  const pruneResult = await pruneStaleWeeklyPoolEntries({
    contestId: contest.id,
    position: input.position,
    eligibleRankableEntryIds,
    isTestWeek: week.isTest,
  });
  const mergePruned = await pruneMergeCompatiblePoolDuplicates(contest.id);

  return {
    contestId: contest.id,
    created,
    updated,
    activated,
    skippedIneligible,
    skippedNonProduction,
    pruned: pruneResult.pruned + mergePruned,
    pruneReasons: pruneResult.reasons,
    skippedNonCanonical,
    candidates: seasonPlayers.length,
    matchupsStamped,
    skippedImmutable: false as const,
  };
}

/** @deprecated Prefer syncWeeklyEligibleFieldFromSeason — kept for admin action compatibility. */
export async function suggestWeeklyPoolFromSeason(input: {
  weekId: string;
  position: ContestPosition;
  scheduledTeamsOnly?: boolean;
}) {
  return syncWeeklyEligibleFieldFromSeason(input);
}

export async function setWeeklyPlayerActivation(input: {
  contestEntryId: string;
  active: boolean;
  inactiveReason?: string | null;
}) {
  return prisma.contestEntry.update({
    where: { id: input.contestEntryId },
    data: {
      excluded: !input.active,
      suggested: input.active ? false : undefined,
      inactiveReason: input.active ? null : (input.inactiveReason ?? null),
    },
  });
}

export async function bulkActivateWeeklyPlayers(input: {
  contestId: string;
  rankableEntryIds: string[];
}) {
  await prisma.contestEntry.updateMany({
    where: {
      contestId: input.contestId,
      rankableEntryId: { in: input.rankableEntryIds },
    },
    data: {
      excluded: false,
      suggested: false,
      inactiveReason: null,
    },
  });

  return prisma.contestEntry.count({
    where: { contestId: input.contestId, excluded: false },
  });
}

export async function activateWeeklyPlayer(input: {
  weekId: string;
  position: ContestPosition;
  rankableEntryId: string;
}) {
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: input.weekId },
  });

  await enrollSeasonPlayer({
    seasonId: week.seasonId,
    rankableEntryId: input.rankableEntryId,
  });

  const contest = await prisma.rankIQContest.findUniqueOrThrow({
    where: {
      weekId_position: { weekId: input.weekId, position: input.position },
    },
  });

  const player = await prisma.seasonPlayer.findUniqueOrThrow({
    where: {
      seasonId_rankableEntryId: {
        seasonId: week.seasonId,
        rankableEntryId: input.rankableEntryId,
      },
    },
  });

  const games = await prisma.nflGame.findMany({ where: { weekId: input.weekId } });
  const game = findGameForTeam(games, player.team);

  if (game) {
    await prisma.rankableEntry.update({
      where: { id: input.rankableEntryId },
      data: {
        opponent: formatOpponentLabel(player.team, game.homeTeam, game.awayTeam),
        gameId: game.id,
        gameStartsAt: game.startsAt,
      },
    });
  }

  return prisma.contestEntry.upsert({
    where: {
      contestId_rankableEntryId: {
        contestId: contest.id,
        rankableEntryId: input.rankableEntryId,
      },
    },
    update: {
      excluded: false,
      suggested: false,
      manuallyAdded: true,
      weekTeam: player.team,
      gameId: game?.id ?? undefined,
      inactiveReason: null,
    },
    create: {
      contestId: contest.id,
      rankableEntryId: input.rankableEntryId,
      gameId: game?.id ?? null,
      weekTeam: player.team,
      excluded: false,
      suggested: false,
      manuallyAdded: true,
    },
  });
}

export async function deactivateWeeklyPlayer(input: {
  contestEntryId: string;
  inactiveReason?: string;
}) {
  return setWeeklyPlayerActivation({
    contestEntryId: input.contestEntryId,
    active: false,
    inactiveReason: input.inactiveReason ?? "Admin deactivated",
  });
}

export async function excludeWeeklyPlayer(input: {
  contestEntryId: string;
  inactiveReason: string;
}) {
  return setWeeklyPlayerActivation({
    contestEntryId: input.contestEntryId,
    active: false,
    inactiveReason: input.inactiveReason,
  });
}
