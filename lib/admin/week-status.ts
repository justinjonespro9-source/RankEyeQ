import type {
  ContestPosition,
  EntryAvailability,
  WeeklyAvailabilitySourceType,
} from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  mapNflStatusToAvailability,
  parseWeeklyAvailability,
  WEEKLY_AVAILABILITY_VALUES,
  type WeeklyAvailability,
} from "@/lib/eligibility/weekly-status";
import {
  DESIGNATION_FULL_LABEL,
  parseWeeklyDesignation,
  presentWeeklyAvailability,
  resolvePlayerWeekStatus,
  WEEKLY_DESIGNATION_VALUES,
  type ResolvedPlayerWeekStatus,
  type WeeklyAvailabilityPresentation,
  type WeeklyDesignation,
} from "@/lib/eligibility/player-week-availability";
import {
  clearPlayerWeekAvailabilityOverride,
  upsertPlayerWeekAvailability,
} from "@/lib/eligibility/player-week-availability-store";
import {
  opponentLabelForWeekGame,
  resolveWeekScopedGame,
  type WeekScopedGame,
} from "@/lib/timing/resolve-contest-kickoff";
import {
  fetchNflComInjuryRows,
} from "@/lib/providers/nfl/nflcom/fetch-injuries";
import type { ParsedInjuryRow } from "@/lib/providers/nfl/nflcom/parse-injuries";
import { normalizePlayerName } from "@/lib/nfl/player-identity";

export { WEEKLY_AVAILABILITY_VALUES, WEEKLY_DESIGNATION_VALUES };
export { DESIGNATION_FULL_LABEL };

export type WeekStatusMatchupDisplay = {
  weekGame: WeekScopedGame | null;
  kickoffAt: Date | null;
  opponent: string;
  /** True when an active (non-excluded) pool entry lacks a week-scoped game. */
  matchupMissing: boolean;
};

/**
 * Week Status kickoff/opponent must come from ContestEntry → NflGame for the
 * selected week only. Never RankableEntry.game / gameStartsAt / opponent.
 */
export function resolveWeekStatusMatchup(input: {
  weekId: string;
  team: string;
  contestGame?: WeekScopedGame | null;
  excluded?: boolean;
}): WeekStatusMatchupDisplay {
  const weekGame = resolveWeekScopedGame({
    weekId: input.weekId,
    contestGame: input.contestGame ?? null,
  });
  const matchupMissing = !input.excluded && !weekGame;
  return {
    weekGame,
    kickoffAt: weekGame?.startsAt ?? null,
    opponent: weekGame
      ? opponentLabelForWeekGame(input.team, weekGame)
      : matchupMissing
        ? "MISSING"
        : "TBD",
    matchupMissing,
  };
}

export type WeekStatusRow = {
  contestEntryId: string;
  rankableEntryId: string;
  contestId: string;
  name: string;
  team: string;
  position: ContestPosition;
  /** Mirrored RankableEntry.availability (compat). */
  availability: EntryAvailability;
  /** Resolved week + roster status. */
  resolved: ResolvedPlayerWeekStatus;
  designation: WeeklyDesignation;
  injuryDescription: string | null;
  sourceType: WeeklyAvailabilitySourceType | null;
  sourceUrl: string | null;
  sourcePublishedAt: Date | null;
  observedAt: Date | null;
  manualOverride: boolean;
  excluded: boolean;
  /** Week-scoped kickoff only (ContestEntry.game for this week). */
  kickoffAt: Date | null;
  /** Week-scoped opponent label (vs X / @ Y) for this week. */
  opponent: string;
  /** Operator-visible when ContestEntry has no valid week game. */
  matchupMissing: boolean;
  selectionCount: number;
  nflStatus: string | null;
  /** True when a current-week PlayerWeekAvailability row exists. */
  hasWeekRecord: boolean;
  /** Operator presentation (labels, practice vs official GS). */
  presentation: WeeklyAvailabilityPresentation;
};

export async function loadWeekStatusBoard(input: {
  weekId: string;
  position?: ContestPosition | "ALL";
  team?: string;
  query?: string;
  /**
   * When true (default for Admin), attach live NFL.com practice / blank-GS
   * context for operator display. Failures are non-fatal.
   */
  enrichInjuryReport?: boolean;
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
      game: {
        select: {
          id: true,
          weekId: true,
          homeTeam: true,
          awayTeam: true,
          startsAt: true,
        },
      },
      rankableEntry: {
        include: {
          seasonPlayers: {
            where: { seasonId: week.seasonId },
            take: 1,
            select: { nflStatus: true },
          },
          weekAvailabilities: {
            where: { weekId: input.weekId },
            take: 1,
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

  let injuryByKey = new Map<string, ParsedInjuryRow>();
  if (input.enrichInjuryReport !== false) {
    try {
      const fetched = await fetchNflComInjuryRows();
      injuryByKey = indexInjuryRowsByPlayerTeam(fetched.rows);
    } catch {
      // Non-fatal — board still loads without practice enrichment.
    }
  }

  return entries.map((entry) => {
    const weekAvail = entry.rankableEntry.weekAvailabilities[0] ?? null;
    const nflStatus = entry.rankableEntry.seasonPlayers[0]?.nflStatus ?? null;
    const hasWeekRecord = weekAvail != null;
    // Master RankableEntry.availability is intentionally NOT used as week status
    // (stale prior-week mirrors). Roster-unavailable still comes from nflStatus.
    const resolved = resolvePlayerWeekStatus({
      nflStatus,
      weekDesignation: weekAvail?.designation as WeeklyDesignation | undefined,
      injuryDescription: weekAvail?.injuryDescription,
      sourceType: weekAvail?.sourceType,
      sourceUrl: weekAvail?.sourceUrl,
      sourcePublishedAt: weekAvail?.sourcePublishedAt,
      observedAt: weekAvail?.observedAt,
      manualOverride: weekAvail?.manualOverride,
    });
    const matchup = resolveWeekStatusMatchup({
      weekId: input.weekId,
      team: entry.rankableEntry.team,
      contestGame: entry.game,
      excluded: entry.excluded,
    });

    const injury = findInjuryRow(
      injuryByKey,
      entry.rankableEntry.name,
      entry.rankableEntry.team,
    );
    const presentation = presentWeeklyAvailability({
      resolved,
      hasWeekRecord,
      practiceStatus: injury?.practiceStatus ?? null,
      onInjuryReportBlankGameStatus: Boolean(
        injury && injury.gameStatus == null,
      ),
      onInjuryReportOfficialGameStatus: Boolean(
        injury && injury.gameStatus != null,
      ),
    });

    return {
      contestEntryId: entry.id,
      rankableEntryId: entry.rankableEntryId,
      contestId: entry.contestId,
      name: entry.rankableEntry.name,
      team: entry.rankableEntry.team,
      position: entry.contest.position,
      availability: resolved.effectiveEntryAvailability,
      resolved,
      designation: resolved.designation,
      injuryDescription: resolved.injuryDescription,
      sourceType: resolved.sourceType,
      sourceUrl: resolved.sourceUrl,
      sourcePublishedAt: resolved.sourcePublishedAt,
      observedAt: resolved.observedAt,
      manualOverride: resolved.manualOverride,
      excluded: entry.excluded,
      kickoffAt: matchup.kickoffAt,
      opponent: matchup.opponent,
      matchupMissing: matchup.matchupMissing,
      selectionCount: countById.get(entry.rankableEntryId) ?? 0,
      nflStatus,
      hasWeekRecord,
      presentation,
    };
  });
}

function injuryRowKey(name: string, team: string) {
  return `${normalizePlayerName(name)}|${team.toUpperCase()}`;
}

function indexInjuryRowsByPlayerTeam(rows: ParsedInjuryRow[]) {
  const map = new Map<string, ParsedInjuryRow>();
  for (const row of rows) {
    map.set(injuryRowKey(row.name, row.team), row);
  }
  return map;
}

function findInjuryRow(
  index: Map<string, ParsedInjuryRow>,
  name: string,
  team: string,
) {
  return index.get(injuryRowKey(name, team)) ?? null;
}

export async function setWeekPlayerDesignations(input: {
  weekId: string;
  rankableEntryIds: string[];
  designation: WeeklyDesignation;
  injuryDescription?: string | null;
  sourceUrl?: string | null;
  sourcePublishedAt?: Date | null;
  updatedByUserId?: string | null;
  clearManualOverride?: boolean;
}) {
  let updated = 0;
  let skippedKickoff = 0;
  for (const rankableEntryId of input.rankableEntryIds) {
    const result = await upsertPlayerWeekAvailability({
      weekId: input.weekId,
      rankableEntryId,
      designation: input.designation,
      injuryDescription: input.injuryDescription,
      sourceUrl: input.sourceUrl,
      sourcePublishedAt: input.sourcePublishedAt,
      sourceType: "MANUAL",
      setManualOverride: !input.clearManualOverride,
      clearManualOverride: input.clearManualOverride,
      updatedByUserId: input.updatedByUserId,
      respectManualOverride: false,
    });
    if (result.status === "skipped_kickoff") skippedKickoff += 1;
    else if (result.status === "updated" || result.status === "unchanged") {
      updated += 1;
    }
  }
  return { updated, skippedKickoff };
}

/** @deprecated Prefer setWeekPlayerDesignations — kept for EntryAvailability callers. */
export async function setRankableAvailability(input: {
  weekId?: string;
  rankableEntryIds: string[];
  availability: EntryAvailability;
  updatedByUserId?: string | null;
}) {
  const designation =
    parseWeeklyDesignation(String(input.availability)) ??
    (String(input.availability).toUpperCase() === "ACTIVE"
      ? "AVAILABLE"
      : null);
  if (!designation) {
    // Roster-like values (IR/PUP/…) still write RankableEntry directly.
    const availability =
      parseWeeklyAvailability(String(input.availability)) ??
      input.availability;
    await prisma.rankableEntry.updateMany({
      where: { id: { in: input.rankableEntryIds } },
      data: { availability },
    });
    return { updated: input.rankableEntryIds.length, availability };
  }

  if (!input.weekId) {
    const mirrored =
      designation === "AVAILABLE"
        ? ("ACTIVE" as EntryAvailability)
        : (designation as EntryAvailability);
    await prisma.rankableEntry.updateMany({
      where: { id: { in: input.rankableEntryIds } },
      data: {
        availability:
          designation === "UNKNOWN"
            ? "ACTIVE"
            : designation === "AVAILABLE"
              ? "ACTIVE"
              : (designation as EntryAvailability),
      },
    });
    return { updated: input.rankableEntryIds.length, availability: mirrored };
  }

  return setWeekPlayerDesignations({
    weekId: input.weekId,
    rankableEntryIds: input.rankableEntryIds,
    designation,
    updatedByUserId: input.updatedByUserId,
  });
}

/**
 * Sync NFL roster membership/status from SeasonPlayer onto RankableEntry.
 * Does NOT invent weekly injury designations (Q/D/OUT).
 * Does NOT overwrite PlayerWeekAvailability rows (injury designations).
 * Does NOT modify ContestEntry / RankableEntry matchup or kickoff fields.
 */
export async function syncWeekAvailabilityFromSeasonPlayers(weekId: string) {
  const week = await prisma.week.findUnique({
    where: { id: weekId },
    select: { seasonId: true },
  });
  if (!week) {
    return { updated: 0, designationsUnchanged: true, matchupsUnchanged: true };
  }

  const contests = await prisma.rankIQContest.findMany({
    where: { weekId },
    select: { id: true },
  });
  const entries = await prisma.contestEntry.findMany({
    where: { contestId: { in: contests.map((c) => c.id) } },
    select: { rankableEntryId: true },
  });
  const ids = [...new Set(entries.map((e) => e.rankableEntryId))];
  if (ids.length === 0) {
    return { updated: 0, designationsUnchanged: true, matchupsUnchanged: true };
  }

  const [seasonPlayers, weekOverrides] = await Promise.all([
    prisma.seasonPlayer.findMany({
      where: { seasonId: week.seasonId, rankableEntryId: { in: ids } },
      select: { rankableEntryId: true, nflStatus: true },
    }),
    prisma.playerWeekAvailability.findMany({
      where: {
        weekId,
        rankableEntryId: { in: ids },
        manualOverride: true,
      },
      select: { rankableEntryId: true },
    }),
  ]);
  const overrideIds = new Set(weekOverrides.map((row) => row.rankableEntryId));

  let updated = 0;
  for (const row of seasonPlayers) {
    if (overrideIds.has(row.rankableEntryId)) continue;
    const mapped = mapNflStatusToAvailability(row.nflStatus);
    // Only push definitive roster-unavailable / ACTIVE — never invent Q/D/OUT
    // from roster codes (those belong on PlayerWeekAvailability via injury sync).
    if (!mapped) continue;
    if (
      mapped === "QUESTIONABLE" ||
      mapped === "DOUBTFUL" ||
      mapped === "OUT"
    ) {
      continue;
    }
    // RankableEntry.availability only — never gameId / gameStartsAt / opponent.
    await prisma.rankableEntry.update({
      where: { id: row.rankableEntryId },
      data: { availability: mapped },
    });
    updated += 1;
  }
  return { updated, designationsUnchanged: true, matchupsUnchanged: true };
}

export async function clearWeekManualOverrides(input: {
  weekId: string;
  rankableEntryIds: string[];
  updatedByUserId?: string | null;
}) {
  let cleared = 0;
  for (const id of input.rankableEntryIds) {
    const result = await clearPlayerWeekAvailabilityOverride({
      weekId: input.weekId,
      rankableEntryId: id,
      updatedByUserId: input.updatedByUserId,
    });
    if (result.cleared) cleared += 1;
  }
  return { cleared };
}

export function isWeeklyAvailability(
  value: string,
): value is WeeklyAvailability {
  return (WEEKLY_AVAILABILITY_VALUES as readonly string[]).includes(value);
}

export function isWeeklyDesignation(value: string): value is WeeklyDesignation {
  return parseWeeklyDesignation(value) != null;
}
