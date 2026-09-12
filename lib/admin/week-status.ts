import type { EntryAvailability } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  mapNflStatusToAvailability,
  parseWeeklyAvailability,
  WEEKLY_AVAILABILITY_VALUES,
  type WeeklyAvailability,
} from "@/lib/eligibility/weekly-status";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export { WEEKLY_AVAILABILITY_VALUES };

export type WeekStatusRow = {
  contestEntryId: string;
  rankableEntryId: string;
  contestId: string;
  name: string;
  team: string;
  position: ContestPosition;
  availability: EntryAvailability;
  excluded: boolean;
  kickoffAt: Date | null;
  selectionCount: number;
  nflStatus: string | null;
};

export async function loadWeekStatusBoard(input: {
  weekId: string;
  position?: ContestPosition | "ALL";
  team?: string;
  query?: string;
}): Promise<WeekStatusRow[]> {
  const week = await prisma.week.findUnique({
    where: { id: input.weekId },
    select: { seasonId: true },
  });
  if (!week) return [];

  const position =
    input.position && input.position !== "ALL" ? input.position : undefined;
  const team = input.team?.trim().toUpperCase() || undefined;
  const query = input.query?.trim() || undefined;

  const contests = await prisma.rankIQContest.findMany({
    where: {
      weekId: input.weekId,
      ...(position ? { position } : {}),
    },
    select: { id: true, position: true },
  });
  if (contests.length === 0) return [];

  const contestIds = contests.map((c) => c.id);
  const entries = await prisma.contestEntry.findMany({
    where: {
      contestId: { in: contestIds },
      rankableEntry: {
        ...(team ? { team } : {}),
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { shortName: { contains: query, mode: "insensitive" } },
                { team: { contains: query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
    },
    include: {
      game: true,
      rankableEntry: {
        include: {
          game: true,
          seasonPlayers: {
            where: { seasonId: week.seasonId },
            take: 1,
            select: { nflStatus: true },
          },
        },
      },
      contest: { select: { position: true } },
    },
    orderBy: [
      { contest: { position: "asc" } },
      { rankableEntry: { name: "asc" } },
    ],
  });

  const selectionCounts = await prisma.rankingPick.groupBy({
    by: ["rankableEntryId"],
    where: {
      submission: {
        contestId: { in: contestIds },
      },
      rankableEntryId: { in: entries.map((e) => e.rankableEntryId) },
    },
    _count: { _all: true },
  });
  const countById = new Map(
    selectionCounts.map((row) => [row.rankableEntryId, row._count._all]),
  );

  return entries.map((entry) => ({
    contestEntryId: entry.id,
    rankableEntryId: entry.rankableEntryId,
    contestId: entry.contestId,
    name: entry.rankableEntry.name,
    team: entry.rankableEntry.team,
    position: entry.contest.position,
    availability: entry.rankableEntry.availability,
    excluded: entry.excluded,
    kickoffAt:
      entry.game?.startsAt ??
      entry.rankableEntry.game?.startsAt ??
      entry.rankableEntry.gameStartsAt ??
      null,
    selectionCount: countById.get(entry.rankableEntryId) ?? 0,
    nflStatus: entry.rankableEntry.seasonPlayers[0]?.nflStatus ?? null,
  }));
}

export async function setRankableAvailability(input: {
  rankableEntryIds: string[];
  availability: EntryAvailability;
}) {
  const availability =
    parseWeeklyAvailability(String(input.availability)) ?? input.availability;
  await prisma.rankableEntry.updateMany({
    where: { id: { in: input.rankableEntryIds } },
    data: { availability },
  });
  return { updated: input.rankableEntryIds.length, availability };
}

export async function syncWeekAvailabilityFromSeasonPlayers(weekId: string) {
  const week = await prisma.week.findUnique({
    where: { id: weekId },
    select: { seasonId: true },
  });
  if (!week) return { updated: 0 };

  const contests = await prisma.rankIQContest.findMany({
    where: { weekId },
    select: { id: true },
  });
  const entries = await prisma.contestEntry.findMany({
    where: { contestId: { in: contests.map((c) => c.id) } },
    select: { rankableEntryId: true },
  });
  const ids = [...new Set(entries.map((e) => e.rankableEntryId))];
  if (ids.length === 0) return { updated: 0 };

  const seasonPlayers = await prisma.seasonPlayer.findMany({
    where: { seasonId: week.seasonId, rankableEntryId: { in: ids } },
    select: { rankableEntryId: true, nflStatus: true },
  });

  let updated = 0;
  for (const row of seasonPlayers) {
    const mapped = mapNflStatusToAvailability(row.nflStatus);
    if (!mapped) continue;
    await prisma.rankableEntry.update({
      where: { id: row.rankableEntryId },
      data: { availability: mapped },
    });
    updated += 1;
  }
  return { updated };
}

export function isWeeklyAvailability(
  value: string,
): value is WeeklyAvailability {
  return (WEEKLY_AVAILABILITY_VALUES as readonly string[]).includes(value);
}
