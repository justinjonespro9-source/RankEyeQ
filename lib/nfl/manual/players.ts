import { prisma } from "@/lib/db";
import { normalizePlayerName } from "@/lib/admin/ai-parser";
import { isMissingTeam } from "@/lib/nfl/manual/parse-common";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export type MasterPlayerFilters = {
  query?: string;
  position?: ContestPosition | "ALL";
  team?: string;
  active?: "ALL" | "ACTIVE" | "INACTIVE";
  missingTeam?: boolean;
  possibleDuplicates?: boolean;
};

export async function searchMasterPlayers(filters: MasterPlayerFilters = {}) {
  const position =
    filters.position && filters.position !== "ALL"
      ? filters.position
      : undefined;
  const active =
    filters.active === "ACTIVE"
      ? true
      : filters.active === "INACTIVE"
        ? false
        : undefined;

  const rows = await prisma.rankableEntry.findMany({
    where: {
      ...(position ? { position } : {}),
      ...(active === undefined ? {} : { active }),
      ...(filters.team
        ? { team: { equals: filters.team.trim().toUpperCase(), mode: "insensitive" } }
        : {}),
      ...(filters.query
        ? {
            OR: [
              { name: { contains: filters.query, mode: "insensitive" } },
              { shortName: { contains: filters.query, mode: "insensitive" } },
              { team: { contains: filters.query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    take: 500,
  });

  let filtered = rows;
  if (filters.missingTeam) {
    filtered = filtered.filter((row) => isMissingTeam(row.team));
  }

  if (filters.possibleDuplicates) {
    const byName = new Map<string, typeof filtered>();
    for (const row of filtered) {
      const key = normalizePlayerName(row.name);
      const list = byName.get(key) ?? [];
      list.push(row);
      byName.set(key, list);
    }
    filtered = filtered.filter(
      (row) => (byName.get(normalizePlayerName(row.name))?.length ?? 0) > 1,
    );
  }

  return filtered;
}

export async function updateMasterPlayer(input: {
  id: string;
  name?: string;
  team?: string;
  position?: ContestPosition;
  active?: boolean;
  headshotUrl?: string | null;
  adminNotes?: string | null;
  externalId?: string;
}) {
  const data: {
    name?: string;
    shortName?: string;
    team?: string;
    position?: ContestPosition;
    active?: boolean;
    headshotUrl?: string | null;
    adminNotes?: string | null;
    externalId?: string;
  } = {};
  if (input.name != null) {
    data.name = input.name.trim();
    const parts = data.name.split(/\s+/);
    data.shortName = parts[parts.length - 1] ?? data.name;
  }
  if (input.team != null) data.team = input.team.trim().toUpperCase();
  if (input.position != null) data.position = input.position;
  if (input.active != null) data.active = input.active;
  if (input.headshotUrl !== undefined) {
    data.headshotUrl = input.headshotUrl?.trim() || null;
  }
  if (input.adminNotes !== undefined) {
    data.adminNotes = input.adminNotes?.trim() || null;
  }
  if (input.externalId != null) data.externalId = input.externalId.trim();

  return prisma.rankableEntry.update({
    where: { id: input.id },
    data,
  });
}

export async function createMasterPlayer(input: {
  name: string;
  position: ContestPosition;
  team: string;
  headshotUrl?: string | null;
  adminNotes?: string | null;
  provider?: string;
}) {
  const name = input.name.trim();
  const team = input.team.trim().toUpperCase();
  const parts = name.split(/\s+/);
  const shortName = parts[parts.length - 1] ?? name;
  const provider = input.provider ?? "manual";
  const externalId = `manual-${name}-${team}-${input.position}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  return prisma.rankableEntry.create({
    data: {
      provider,
      externalId: `${externalId}-${Date.now().toString(36)}`,
      type: input.position === "DEF" ? "DEFENSE" : "PLAYER",
      name,
      shortName,
      team,
      position: input.position,
      opponent: "TBD",
      headshotUrl: input.headshotUrl?.trim() || null,
      adminNotes: input.adminNotes?.trim() || null,
      active: true,
    },
  });
}
