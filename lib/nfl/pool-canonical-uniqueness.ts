import { prisma } from "@/lib/db";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { defenseEntryIdentityKey } from "@/lib/nfl/defense-identity";
import {
  groupPoolRowsByIdentity,
  pickPreferredPoolRow,
  poolEntryIdentityKey,
  type PoolIdentityMeta,
} from "@/lib/nfl/pool-identity";
import {
  playerIdentityGroupKey,
  playerNamesCanMerge,
} from "@/lib/nfl/player-identity";

export type PoolDuplicateRow = {
  contestId: string;
  position: ContestPosition;
  identityKey: string;
  entries: Array<{
    contestEntryId: string;
    rankableEntryId: string;
    name: string;
    team: string;
    provider: string;
    externalId: string;
  }>;
};

function entryIdentityKey(input: PoolIdentityMeta) {
  return poolEntryIdentityKey(input);
}

function toPoolMeta(input: {
  name: string;
  position: ContestPosition;
  provider: string;
  externalId: string;
  team: string;
  type: string;
}): PoolIdentityMeta {
  return input;
}

export async function findWeeklyPoolCanonicalDuplicates(
  weekId: string,
): Promise<PoolDuplicateRow[]> {
  const contests = await prisma.rankIQContest.findMany({
    where: { weekId },
    include: {
      entries: {
        where: { excluded: false },
        include: { rankableEntry: true },
      },
    },
  });

  const duplicates: PoolDuplicateRow[] = [];

  for (const contest of contests) {
    const rows = contest.entries.map((entry) => ({
      contestEntryId: entry.id,
      rankableEntryId: entry.rankableEntryId,
      manuallyAdded: entry.manuallyAdded,
      meta: toPoolMeta({
        name: entry.rankableEntry.name,
        position: entry.rankableEntry.position,
        provider: entry.rankableEntry.provider,
        externalId: entry.rankableEntry.externalId,
        team: entry.weekTeam ?? entry.rankableEntry.team,
        type: entry.rankableEntry.type,
      }),
    }));

    const groups = groupPoolRowsByIdentity(rows);
    for (const [identityKey, group] of groups) {
      if (group.length < 2) continue;
      duplicates.push({
        contestId: contest.id,
        position: contest.position,
        identityKey,
        entries: group.map((row) => ({
          contestEntryId: row.contestEntryId,
          rankableEntryId: row.rankableEntryId,
          name: row.meta.name,
          team: row.meta.team,
          provider: row.meta.provider,
          externalId: row.meta.externalId,
        })),
      });
    }
  }

  return duplicates;
}

export async function validateWeeklyPoolCanonicalUniqueness(weekId: string) {
  const duplicates = await findWeeklyPoolCanonicalDuplicates(weekId);
  const defense = await validateDefenseFranchiseUniqueness(weekId);
  const blockers = [
    ...duplicates.map(
      (row) =>
        `${row.position} pool has duplicate canonical player "${row.entries.map((entry) => `${entry.name} (${entry.team}/${entry.provider})`).join(" vs ")}"`,
    ),
    ...defense.blockers,
  ];
  return {
    ok: duplicates.length === 0 && defense.ok,
    duplicates,
    defense,
    blockers,
  };
}

export async function validateDefenseFranchiseUniqueness(weekId: string) {
  const contest = await prisma.rankIQContest.findUnique({
    where: { weekId_position: { weekId, position: "DEF" } },
    include: {
      entries: {
        where: { excluded: false },
        include: { rankableEntry: true },
      },
    },
  });

  if (!contest) {
    return { ok: true, franchises: 0, blockers: [] as string[] };
  }

  const franchises = new Map<string, number>();
  for (const entry of contest.entries) {
    const team = entry.weekTeam ?? entry.rankableEntry.team;
    const key = defenseEntryIdentityKey({
      team,
      position: "DEF",
      provider: entry.rankableEntry.provider,
      externalId: entry.rankableEntry.externalId,
      type: entry.rankableEntry.type,
    });
    franchises.set(key, (franchises.get(key) ?? 0) + 1);
  }

  const blockers: string[] = [];
  for (const [franchise, count] of franchises) {
    if (count > 1) {
      blockers.push(
        `DEF pool has ${count} active entries for franchise ${franchise}`,
      );
    }
  }

  const games = await prisma.nflGame.findMany({
    where: { weekId },
    select: { homeTeam: true, awayTeam: true },
  });
  const scheduledTeams = new Set<string>();
  for (const game of games) {
    scheduledTeams.add(game.homeTeam);
    scheduledTeams.add(game.awayTeam);
  }

  const expectedDefenses =
    scheduledTeams.size >= 32 || games.length >= 16
      ? 32
      : scheduledTeams.size;

  if (expectedDefenses > 0 && contest.entries.length !== expectedDefenses) {
    if (expectedDefenses === 32) {
      blockers.push(
        `DEF pool must contain exactly 32 franchises for a full NFL week (found ${contest.entries.length})`,
      );
    } else {
      blockers.push(
        `DEF pool must contain one entry per scheduled team (expected ${expectedDefenses}, found ${contest.entries.length})`,
      );
    }
  }

  return {
    ok: blockers.length === 0,
    franchises: franchises.size,
    blockers,
  };
}

export function dedupeRankingPlayersByIdentity<
  T extends { id: string; name: string; team: string },
>(
  players: T[],
  metaById?: Map<
    string,
    {
      provider?: string;
      externalId?: string;
      position?: ContestPosition;
      type?: string;
    }
  >,
) {
  const rows = players.map((player) => {
    const meta = metaById?.get(player.id);
    return {
      rankableEntryId: player.id,
      manuallyAdded: false,
      player,
      meta: toPoolMeta({
        name: player.name,
        position: (meta?.position ?? "RB") as ContestPosition,
        provider: meta?.provider ?? "",
        externalId: meta?.externalId ?? "",
        team: player.team,
        type: meta?.type ?? "PLAYER",
      }),
    };
  });

  const groups = groupPoolRowsByIdentity(rows);
  const kept: T[] = [];
  for (const group of groups.values()) {
    const preferred = pickPreferredPoolRow(group);
    kept.push(preferred.player);
  }
  return kept;
}

export { entryIdentityKey, playerIdentityGroupKey, playerNamesCanMerge };
