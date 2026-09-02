import { prisma } from "@/lib/db";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";

function splitName(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) {
    return { firstName: parts[0] ?? name, lastName: null as string | null };
  }
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1] ?? null,
  };
}

export async function enrollSeasonPlayer(input: {
  seasonId: string;
  rankableEntryId: string;
  team?: string;
  nflStatus?: string;
  activeOnNFLRoster?: boolean;
  sourcePosition?: string | null;
  sourceNflStatus?: string | null;
}) {
  const entry = await prisma.rankableEntry.findUniqueOrThrow({
    where: { id: input.rankableEntryId },
  });
  const { firstName, lastName } = splitName(entry.name);
  const team = (input.team ?? entry.team).trim().toUpperCase();

  return prisma.seasonPlayer.upsert({
    where: {
      seasonId_rankableEntryId: {
        seasonId: input.seasonId,
        rankableEntryId: entry.id,
      },
    },
    update: {
      displayName: entry.name,
      firstName,
      lastName,
      team,
      position: entry.position,
      nflStatus: input.nflStatus ?? undefined,
      activeOnNFLRoster: input.activeOnNFLRoster ?? undefined,
      sourcePosition: input.sourcePosition ?? undefined,
      sourceNflStatus: input.sourceNflStatus ?? undefined,
    },
    create: {
      seasonId: input.seasonId,
      rankableEntryId: entry.id,
      displayName: entry.name,
      firstName,
      lastName,
      team,
      position: entry.position,
      nflStatus: input.nflStatus ?? "ACTIVE",
      activeOnNFLRoster: input.activeOnNFLRoster ?? true,
      sourcePosition: input.sourcePosition ?? null,
      sourceNflStatus: input.sourceNflStatus ?? null,
    },
  });
}

export async function syncSeasonPlayersFromDirectory(input: {
  seasonId: string;
  provider?: string;
  position?: ContestPosition;
  /** When set, only enroll these directory rows (used by tests and targeted admin repair). */
  rankableEntryIds?: string[];
}) {
  const provider = input.provider ?? NFL_COM_BOOTSTRAP_PROVIDER;
  const entries = await prisma.rankableEntry.findMany({
    where: {
      provider,
      ...(input.position ? { position: input.position } : {}),
      active: true,
      ...(input.rankableEntryIds
        ? { id: { in: input.rankableEntryIds } }
        : {}),
    },
    orderBy: { name: "asc" },
  });

  let created = 0;
  let updated = 0;
  for (const entry of entries) {
    const existing = await prisma.seasonPlayer.findUnique({
      where: {
        seasonId_rankableEntryId: {
          seasonId: input.seasonId,
          rankableEntryId: entry.id,
        },
      },
    });
    await enrollSeasonPlayer({
      seasonId: input.seasonId,
      rankableEntryId: entry.id,
    });
    if (existing) updated += 1;
    else created += 1;
  }

  return { created, updated, total: entries.length };
}

export async function searchSeasonPlayers(input: {
  seasonId: string;
  position?: ContestPosition | "ALL";
  team?: string;
  query?: string;
  activeOnRoster?: "ALL" | "YES" | "NO";
}) {
  return prisma.seasonPlayer.findMany({
    where: {
      seasonId: input.seasonId,
      ...(input.position && input.position !== "ALL"
        ? { position: input.position }
        : {}),
      ...(input.team
        ? { team: { equals: input.team.trim().toUpperCase(), mode: "insensitive" } }
        : {}),
      ...(input.activeOnRoster === "YES"
        ? { activeOnNFLRoster: true }
        : input.activeOnRoster === "NO"
          ? { activeOnNFLRoster: false }
          : {}),
      ...(input.query
        ? {
            OR: [
              { displayName: { contains: input.query, mode: "insensitive" } },
              { team: { contains: input.query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: { rankableEntry: true },
    orderBy: [{ position: "asc" }, { displayName: "asc" }],
    take: 500,
  });
}

export async function updateSeasonPlayer(input: {
  id: string;
  team?: string;
  nflStatus?: string;
  activeOnNFLRoster?: boolean;
  displayName?: string;
}) {
  const data: {
    team?: string;
    nflStatus?: string;
    activeOnNFLRoster?: boolean;
    displayName?: string;
    firstName?: string | null;
    lastName?: string | null;
  } = {};

  if (input.team != null) data.team = input.team.trim().toUpperCase();
  if (input.nflStatus != null) data.nflStatus = input.nflStatus.trim();
  if (input.activeOnNFLRoster != null) {
    data.activeOnNFLRoster = input.activeOnNFLRoster;
  }
  if (input.displayName != null) {
    data.displayName = input.displayName.trim();
    const split = splitName(data.displayName);
    data.firstName = split.firstName;
    data.lastName = split.lastName;
  }

  const row = await prisma.seasonPlayer.update({
    where: { id: input.id },
    data,
    include: { rankableEntry: true },
  });

  if (input.team != null) {
    await prisma.rankableEntry.update({
      where: { id: row.rankableEntryId },
      data: { team: data.team },
    });
  }

  return row;
}
