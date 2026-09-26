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
  practiceStatus?: string | null;
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
   * When true (NFL_SYNC / IMPORT), skip designation writes on manualOverride.
   * Defaults true for non-MANUAL source types.
   */
  respectManualOverride?: boolean;
  /**
   * Skip updates after the player's kickoff (preserves lock/promotion freeze).
   * Defaults true.
   */
  skipAfterKickoff?: boolean;
  /**
   * When designation is unchanged, skip RankableEntry.availability mirror.
   * Used for practice-context-only NFL_SYNC updates.
   */
  skipRankableMirrorWhenDesignationUnchanged?: boolean;
  now?: Date;
};

export type UpsertWeekAvailabilityResult =
  | { status: "updated"; mirroredAvailability: EntryAvailability }
  | { status: "updated_context_only" }
  | { status: "skipped_override" }
  | { status: "skipped_kickoff" }
  | { status: "unchanged"; mirroredAvailability: EntryAvailability };

function kickoffForRankable(
  entry: {
    gameStartsAt: Date | null;
    game: { startsAt: Date; weekId: string | null } | null;
    contestEntries: Array<{
      game: { startsAt: Date; weekId: string | null } | null;
    }>;
  },
  weekId: string,
): Date | null {
  // Week-scoped ContestEntry.game only — never RankableEntry master fallbacks.
  const contestGame = entry.contestEntries[0]?.game ?? null;
  if (contestGame && contestGame.weekId === weekId) {
    return contestGame.startsAt;
  }
  return null;
}

/**
 * NFL_SYNC may refresh factual practice/injury fields on an ADMIN_OVERRIDE row
 * without touching designation, manualOverride, sourceType, or sourceUrl.
 */
export async function updateInjuryContextPreservingOverride(input: {
  weekId: string;
  rankableEntryId: string;
  injuryDescription?: string | null;
  practiceStatus?: string | null;
  observedAt?: Date;
}): Promise<
  | { status: "updated_context_only" }
  | { status: "unchanged" }
  | { status: "not_override" }
  | { status: "missing" }
> {
  const existing = await prisma.playerWeekAvailability.findUnique({
    where: {
      weekId_rankableEntryId: {
        weekId: input.weekId,
        rankableEntryId: input.rankableEntryId,
      },
    },
  });
  if (!existing) return { status: "missing" };
  if (!existing.manualOverride) return { status: "not_override" };

  const injuryDescription =
    input.injuryDescription === undefined
      ? existing.injuryDescription
      : input.injuryDescription?.trim() || null;
  const practiceStatus =
    input.practiceStatus === undefined
      ? existing.practiceStatus
      : input.practiceStatus?.trim() || null;
  const observedAt = input.observedAt ?? new Date();

  if (
    (existing.injuryDescription ?? null) === (injuryDescription ?? null) &&
    (existing.practiceStatus ?? null) === (practiceStatus ?? null)
  ) {
    return { status: "unchanged" };
  }

  await prisma.playerWeekAvailability.update({
    where: { id: existing.id },
    data: {
      injuryDescription,
      practiceStatus,
      observedAt,
      // Preserve: designation, manualOverride, sourceType, sourceUrl,
      // sourcePublishedAt, updatedByUserId.
    },
  });
  return { status: "updated_context_only" };
}

/**
 * Upsert PlayerWeekAvailability and mirror a compatible EntryAvailability onto
 * RankableEntry so existing reserve/UI paths keep working for this week.
 *
 * Manual overrides take precedence over NFL_SYNC / IMPORT designation writes
 * until cleared. Use updateInjuryContextPreservingOverride for safe context
 * refresh under an admin override.
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
  const practiceStatus =
    input.practiceStatus === undefined
      ? (existing?.practiceStatus ?? null)
      : input.practiceStatus?.trim() || null;
  const sourceUrl =
    input.sourceUrl === undefined
      ? (existing?.sourceUrl ?? null)
      : input.sourceUrl?.trim() || null;
  const sourcePublishedAt =
    input.sourcePublishedAt === undefined
      ? (existing?.sourcePublishedAt ?? null)
      : input.sourcePublishedAt;
  const observedAt = input.observedAt ?? now;

  const designationUnchanged = existing?.designation === designation;
  const unchanged =
    existing &&
    designationUnchanged &&
    (existing.injuryDescription ?? null) === injuryDescription &&
    (existing.practiceStatus ?? null) === practiceStatus &&
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
      practiceStatus,
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
      practiceStatus,
      sourceUrl,
      sourcePublishedAt,
      observedAt,
      sourceType: input.sourceType,
      manualOverride,
      updatedByUserId: input.updatedByUserId ?? null,
    },
  });

  const mirroredAvailability = entryAvailabilityFromDesignation(designation);

  const skipMirror =
    input.skipRankableMirrorWhenDesignationUnchanged &&
    designationUnchanged &&
    existing != null;

  if (!skipMirror) {
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
      practiceStatus,
    });

    await prisma.rankableEntry.update({
      where: { id: input.rankableEntryId },
      data: { availability: resolved.effectiveEntryAvailability },
    });
  }

  if (unchanged) {
    return { status: "unchanged", mirroredAvailability };
  }
  if (
    designationUnchanged &&
    existing &&
    ((existing.injuryDescription ?? null) !== injuryDescription ||
      (existing.practiceStatus ?? null) !== practiceStatus)
  ) {
    return { status: "updated_context_only" };
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

  const [weekRows, seasonPlayers] = await Promise.all([
    prisma.playerWeekAvailability.findMany({
      where: { weekId: input.weekId, rankableEntryId: { in: ids } },
    }),
    prisma.seasonPlayer.findMany({
      where: { seasonId: input.seasonId, rankableEntryId: { in: ids } },
      select: { rankableEntryId: true, nflStatus: true },
    }),
  ]);

  const weekById = new Map(weekRows.map((row) => [row.rankableEntryId, row]));
  const rosterById = new Map(
    seasonPlayers.map((row) => [row.rankableEntryId, row.nflStatus]),
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
        practiceStatus: week?.practiceStatus,
        sourceType: week?.sourceType,
        sourceUrl: week?.sourceUrl,
        sourcePublishedAt: week?.sourcePublishedAt,
        observedAt: week?.observedAt,
        manualOverride: week?.manualOverride,
        // Intentionally omit RankableEntry.availability — not week-scoped.
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
