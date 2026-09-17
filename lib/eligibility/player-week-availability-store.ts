import { prisma } from "@/lib/db";
import type {
  EntryAvailability,
  WeeklyAvailabilityDesignation,
  WeeklyAvailabilitySourceType,
} from "@/lib/generated/prisma/client";
import {
  entryAvailabilityFromDesignation,
  parseWeeklyDesignation,
  resolvePlayerWeekStatus,
  type ResolvedPlayerWeekStatus,
  type WeeklyDesignation,
} from "@/lib/eligibility/player-week-availability";
import { kickoffHasPassed } from "@/lib/timing/partial-lock";

export type UpsertWeekAvailabilityInput = {
  weekId: string;
  rankableEntryId: string;
  designation: WeeklyDesignation;
  injuryDescription?: string | null;
  sourceUrl?: string | null;
  sourcePublishedAt?: Date | null;
  observedAt?: Date;
  sourceType: WeeklyAvailabilitySourceType;
  /** When true, mark manualOverride and protect from sync. */
  setManualOverride?: boolean;
  /** When true, clear manualOverride so sync may write again. */
  clearManualOverride?: boolean;
  updatedByUserId?: string | null;
  /**
   * When true (NFL_SYNC / IMPORT), skip rows with manualOverride.
   * Defaults true for non-MANUAL source types.
   */
  respectManualOverride?: boolean;
  /**
   * Skip updates after the player's kickoff (preserves lock/promotion freeze).
   * Defaults true.
   */
  skipAfterKickoff?: boolean;
  now?: Date;
};

export type UpsertWeekAvailabilityResult =
  | { status: "updated"; mirroredAvailability: EntryAvailability }
  | { status: "skipped_override" }
  | { status: "skipped_kickoff" }
  | { status: "unchanged"; mirroredAvailability: EntryAvailability };

function kickoffForRankable(entry: {
  gameStartsAt: Date | null;
  game: { startsAt: Date; weekId: string | null } | null;
  contestEntries: Array<{
    game: { startsAt: Date; weekId: string | null } | null;
  }>;
}, weekId: string): Date | null {
  // Week-scoped ContestEntry.game only — never RankableEntry master fallbacks.
  const contestGame = entry.contestEntries[0]?.game ?? null;
  if (contestGame && contestGame.weekId === weekId) {
    return contestGame.startsAt;
  }
  return null;
}

/**
 * Upsert PlayerWeekAvailability and mirror a compatible EntryAvailability onto
 * RankableEntry so existing reserve/UI paths keep working for this week.
 *
 * Manual overrides take precedence over NFL_SYNC / IMPORT until cleared.
 */
export async function upsertPlayerWeekAvailability(
  input: UpsertWeekAvailabilityInput,
): Promise<UpsertWeekAvailabilityResult> {
  const now = input.now ?? new Date();
  const respectOverride =
    input.respectManualOverride ?? input.sourceType !== "MANUAL";
  const skipAfterKickoff = input.skipAfterKickoff ?? true;

  const existing = await prisma.playerWeekAvailability.findUnique({
    where: {
      weekId_rankableEntryId: {
        weekId: input.weekId,
        rankableEntryId: input.rankableEntryId,
      },
    },
  });

  if (respectOverride && existing?.manualOverride) {
    return { status: "skipped_override" };
  }

  if (skipAfterKickoff) {
    const entry = await prisma.rankableEntry.findUnique({
      where: { id: input.rankableEntryId },
      select: {
        gameStartsAt: true,
        game: { select: { startsAt: true, weekId: true } },
        contestEntries: {
          where: { contest: { weekId: input.weekId } },
          take: 1,
          select: { game: { select: { startsAt: true, weekId: true } } },
        },
      },
    });
    if (entry) {
      const kickoff = kickoffForRankable(entry, input.weekId);
      if (kickoffHasPassed(kickoff, now)) {
        return { status: "skipped_kickoff" };
      }
    }
  }

  const manualOverride = input.clearManualOverride
    ? false
    : input.setManualOverride
      ? true
      : (existing?.manualOverride ?? false);

  const designation = input.designation;
  const injuryDescription =
    input.injuryDescription === undefined
      ? (existing?.injuryDescription ?? null)
      : input.injuryDescription?.trim() || null;
  const sourceUrl =
    input.sourceUrl === undefined
      ? (existing?.sourceUrl ?? null)
      : input.sourceUrl?.trim() || null;
  const sourcePublishedAt =
    input.sourcePublishedAt === undefined
      ? (existing?.sourcePublishedAt ?? null)
      : input.sourcePublishedAt;
  const observedAt = input.observedAt ?? now;

  const unchanged =
    existing &&
    existing.designation === designation &&
    (existing.injuryDescription ?? null) === injuryDescription &&
    (existing.sourceUrl ?? null) === sourceUrl &&
    existing.manualOverride === manualOverride &&
    existing.sourceType === input.sourceType;

  await prisma.playerWeekAvailability.upsert({
    where: {
      weekId_rankableEntryId: {
        weekId: input.weekId,
        rankableEntryId: input.rankableEntryId,
      },
    },
    create: {
      weekId: input.weekId,
      rankableEntryId: input.rankableEntryId,
      designation,
      injuryDescription,
      sourceUrl,
      sourcePublishedAt,
      observedAt,
      sourceType: input.sourceType,
      manualOverride,
      updatedByUserId: input.updatedByUserId ?? null,
    },
    update: {
      designation,
      injuryDescription,
      sourceUrl,
      sourcePublishedAt,
      observedAt,
      sourceType: input.sourceType,
      manualOverride,
      updatedByUserId: input.updatedByUserId ?? null,
    },
  });

  const mirroredAvailability = entryAvailabilityFromDesignation(designation);

  // Only mirror weekly injury designations onto RankableEntry when the player
  // is not already roster-unavailable (IR/PUP/etc. from season sync).
  const seasonPlayer = await prisma.seasonPlayer.findFirst({
    where: {
      rankableEntryId: input.rankableEntryId,
      season: { weeks: { some: { id: input.weekId } } },
    },
    select: { nflStatus: true },
  });
  const resolved = resolvePlayerWeekStatus({
    nflStatus: seasonPlayer?.nflStatus,
    weekDesignation: designation,
    injuryDescription,
  });

  await prisma.rankableEntry.update({
    where: { id: input.rankableEntryId },
    data: { availability: resolved.effectiveEntryAvailability },
  });

  if (unchanged) {
    return { status: "unchanged", mirroredAvailability };
  }
  return { status: "updated", mirroredAvailability };
}

export async function clearPlayerWeekAvailabilityOverride(input: {
  weekId: string;
  rankableEntryId: string;
  updatedByUserId?: string | null;
}) {
  const existing = await prisma.playerWeekAvailability.findUnique({
    where: {
      weekId_rankableEntryId: {
        weekId: input.weekId,
        rankableEntryId: input.rankableEntryId,
      },
    },
  });
  if (!existing) return { cleared: false };
  await prisma.playerWeekAvailability.update({
    where: { id: existing.id },
    data: {
      manualOverride: false,
      updatedByUserId: input.updatedByUserId ?? null,
    },
  });
  return { cleared: true };
}

export async function loadResolvedStatusesForWeek(input: {
  weekId: string;
  rankableEntryIds: string[];
  seasonId: string;
}): Promise<Map<string, ResolvedPlayerWeekStatus>> {
  const ids = [...new Set(input.rankableEntryIds)];
  if (ids.length === 0) return new Map();

  const [weekRows, seasonPlayers, rankables] = await Promise.all([
    prisma.playerWeekAvailability.findMany({
      where: { weekId: input.weekId, rankableEntryId: { in: ids } },
    }),
    prisma.seasonPlayer.findMany({
      where: { seasonId: input.seasonId, rankableEntryId: { in: ids } },
      select: { rankableEntryId: true, nflStatus: true },
    }),
    prisma.rankableEntry.findMany({
      where: { id: { in: ids } },
      select: { id: true, availability: true },
    }),
  ]);

  const weekById = new Map(weekRows.map((row) => [row.rankableEntryId, row]));
  const rosterById = new Map(
    seasonPlayers.map((row) => [row.rankableEntryId, row.nflStatus]),
  );
  const fallbackById = new Map(
    rankables.map((row) => [row.id, row.availability]),
  );

  const out = new Map<string, ResolvedPlayerWeekStatus>();
  for (const id of ids) {
    const week = weekById.get(id);
    out.set(
      id,
      resolvePlayerWeekStatus({
        nflStatus: rosterById.get(id) ?? null,
        weekDesignation: week?.designation as WeeklyDesignation | undefined,
        injuryDescription: week?.injuryDescription,
        sourceType: week?.sourceType,
        sourceUrl: week?.sourceUrl,
        sourcePublishedAt: week?.sourcePublishedAt,
        observedAt: week?.observedAt,
        manualOverride: week?.manualOverride,
        fallbackEntryAvailability: fallbackById.get(id),
      }),
    );
  }
  return out;
}

export function coerceDesignationOrThrow(
  value: string,
): WeeklyAvailabilityDesignation {
  const parsed = parseWeeklyDesignation(value);
  if (!parsed) {
    throw new Error(`Invalid weekly designation: ${value}`);
  }
  return parsed;
}
