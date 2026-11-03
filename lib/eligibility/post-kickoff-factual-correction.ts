/**
 * Post-Kickoff Factual Correction — admin-only exception path.
 *
 * Ordinary availability writes keep skipAfterKickoff: true.
 * This workflow:
 *  1. Writes OUT/INACTIVE despite kickoff (authorized only), OR
 *     skips the PWA rewrite when designation is already correct.
 *  2. Revises RankingPick.wasUnavailableAtKickoff so deriveEffectiveBoard
 *     displaces the player after kickoff (original predictedRank unchanged).
 *  3. Does NOT auto-regrade — operator must regrade explicitly.
 *  4. Does NOT rewrite consensus / pregame snapshots.
 *
 * Freeze-only path (already-correct OUT/INACTIVE + missing freeze):
 *  - Requires sourcePublishedAt strictly before kickoff (pregame fact).
 *  - Does not invent or broaden corrections to unrelated players.
 *  - Idempotent: picks already frozen true are left untouched.
 */

import { prisma } from "@/lib/db";
import { logAdminAction } from "@/lib/admin/audit";
import { upsertPlayerWeekAvailability } from "@/lib/eligibility/player-week-availability-store";
import type { WeeklyDesignation } from "@/lib/eligibility/player-week-availability";
import { kickoffHasPassed } from "@/lib/timing/partial-lock";

export const POST_KICKOFF_FACTUAL_CORRECTION_ACTION =
  "week_status.post_kickoff_factual_correction";

export const POST_KICKOFF_CORRECTION_DESIGNATIONS = [
  "OUT",
  "INACTIVE",
] as const;

export type PostKickoffCorrectionDesignation =
  (typeof POST_KICKOFF_CORRECTION_DESIGNATIONS)[number];

export function isPostKickoffCorrectionDesignation(
  value: string,
): value is PostKickoffCorrectionDesignation {
  return (POST_KICKOFF_CORRECTION_DESIGNATIONS as readonly string[]).includes(
    value,
  );
}

/** Fantasy points / snaps alone never qualify — status must be OUT/INACTIVE. */
export function factualStatusQualifiesForReserveDisplacement(
  designation: string | null | undefined,
): boolean {
  if (!designation) return false;
  const key = designation.toUpperCase();
  return key === "OUT" || key === "INACTIVE";
}

export function zeroFantasyPointsAloneNeverDisplaces(): boolean {
  // Documented invariant — no code path uses fantasy points for promotion.
  return true;
}

function kickoffForWeekEntry(
  input: {
    contestEntries: Array<{
      game: { startsAt: Date; weekId: string | null } | null;
    }>;
  },
  weekId: string,
): Date | null {
  const contestGame = input.contestEntries[0]?.game ?? null;
  if (contestGame && contestGame.weekId === weekId) {
    return contestGame.startsAt;
  }
  return null;
}

function parseSourcePublishedAt(
  value: Date | string | null | undefined,
): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * True when PWA designation already matches the authorized correction target.
 * Used to skip an unnecessary availability rewrite and only stamp freezes.
 */
export function availabilityAlreadyMatchesCorrection(
  existingDesignation: string | null | undefined,
  target: PostKickoffCorrectionDesignation,
): boolean {
  if (!existingDesignation) return false;
  return existingDesignation.toUpperCase() === target;
}

/**
 * Pregame OUT/INACTIVE evidence must be published before the player's kickoff.
 * In-game injury publications (at/after kickoff) never qualify.
 */
export function sourceEstablishesPregameUnavailability(input: {
  sourcePublishedAt: Date;
  kickoffAt: Date;
}): boolean {
  return input.sourcePublishedAt.getTime() < input.kickoffAt.getTime();
}

export type ApplyPostKickoffFactualCorrectionInput = {
  weekId: string;
  rankableEntryId: string;
  designation: PostKickoffCorrectionDesignation;
  /** Required operator reason (why this factual correction is authorized). */
  reason: string;
  /** Factual source URL or free-text reference. */
  sourceReference: string;
  /**
   * When the OUT/INACTIVE fact was published. Required for freeze-only path
   * (already-correct designation); must be strictly before kickoff.
   */
  sourcePublishedAt?: Date | string | null;
  adminUserId: string;
  now?: Date;
};

export type ApplyPostKickoffFactualCorrectionResult =
  | {
      ok: true;
      previousDesignation: WeeklyDesignation | null;
      correctedDesignation: PostKickoffCorrectionDesignation;
      kickoffAt: Date;
      freezePicksUpdated: number;
      /** Picks already frozen true — left untouched (idempotent). */
      freezePicksAlreadyCorrect: number;
      /**
       * When true, PWA designation already matched; only missing freezes were
       * stamped (no unnecessary availability rewrite).
       */
      freezeOnlyCorrection: boolean;
      availabilityUpsertStatus:
        | "updated"
        | "unchanged"
        | "updated_context_only"
        | "skipped_already_correct"
        | null;
      affectedContestIds: string[];
      requiresRegrade: boolean;
      auditLogId: string;
    }
  | {
      ok: false;
      error:
        | "invalid_designation"
        | "missing_reason"
        | "missing_source"
        | "missing_source_published_at"
        | "source_not_before_kickoff"
        | "kickoff_not_passed"
        | "kickoff_unknown"
        | "player_not_found"
        | "availability_write_failed"
        | "nothing_to_correct";
      message: string;
    };

/**
 * Authorized post-kickoff OUT/INACTIVE correction.
 * Requires kickoff to have already passed for this week-scoped player.
 */
export async function applyPostKickoffFactualCorrection(
  input: ApplyPostKickoffFactualCorrectionInput,
): Promise<ApplyPostKickoffFactualCorrectionResult> {
  if (!isPostKickoffCorrectionDesignation(input.designation)) {
    return {
      ok: false,
      error: "invalid_designation",
      message: "Post-kickoff correction allows OUT or INACTIVE only.",
    };
  }

  const reason = input.reason.trim();
  if (!reason) {
    return {
      ok: false,
      error: "missing_reason",
      message: "A reason for the factual correction is required.",
    };
  }

  const sourceReference = input.sourceReference.trim();
  if (!sourceReference) {
    return {
      ok: false,
      error: "missing_source",
      message: "A factual source / reference is required.",
    };
  }

  const now = input.now ?? new Date();
  const sourcePublishedAt = parseSourcePublishedAt(input.sourcePublishedAt);

  const entry = await prisma.rankableEntry.findUnique({
    where: { id: input.rankableEntryId },
    select: {
      id: true,
      name: true,
      contestEntries: {
        where: { contest: { weekId: input.weekId } },
        take: 1,
        select: {
          contestId: true,
          game: { select: { startsAt: true, weekId: true } },
        },
      },
    },
  });

  if (!entry) {
    return {
      ok: false,
      error: "player_not_found",
      message: "Player not found.",
    };
  }

  const kickoffAt = kickoffForWeekEntry(entry, input.weekId);
  if (!kickoffAt) {
    return {
      ok: false,
      error: "kickoff_unknown",
      message:
        "No week-scoped kickoff found for this player. Stamp matchups before using Post-Kickoff Factual Correction.",
    };
  }

  if (!kickoffHasPassed(kickoffAt, now)) {
    return {
      ok: false,
      error: "kickoff_not_passed",
      message:
        "Player kickoff has not passed. Use ordinary weekly designation controls instead.",
    };
  }

  const existing = await prisma.playerWeekAvailability.findUnique({
    where: {
      weekId_rankableEntryId: {
        weekId: input.weekId,
        rankableEntryId: input.rankableEntryId,
      },
    },
  });
  const previousDesignation =
    (existing?.designation as WeeklyDesignation | undefined) ?? null;

  const freezeOnlyCorrection = availabilityAlreadyMatchesCorrection(
    previousDesignation,
    input.designation,
  );

  // Freeze-only (already-correct OUT/INACTIVE) requires pregame publication
  // evidence — never treat an in-game injury report as pregame unavailability.
  if (freezeOnlyCorrection) {
    if (!sourcePublishedAt) {
      return {
        ok: false,
        error: "missing_source_published_at",
        message:
          "Freeze-only correction requires sourcePublishedAt establishing OUT/INACTIVE before kickoff.",
      };
    }
    if (
      !sourceEstablishesPregameUnavailability({
        sourcePublishedAt,
        kickoffAt,
      })
    ) {
      return {
        ok: false,
        error: "source_not_before_kickoff",
        message:
          "Source publication is not before kickoff — in-game injuries do not qualify for pregame freeze correction.",
      };
    }
  } else if (sourcePublishedAt) {
    // When changing designation, if operator supplies publication time, enforce
    // the same pregame evidence rule.
    if (
      !sourceEstablishesPregameUnavailability({
        sourcePublishedAt,
        kickoffAt,
      })
    ) {
      return {
        ok: false,
        error: "source_not_before_kickoff",
        message:
          "Source publication is not before kickoff — in-game injuries do not qualify for pregame freeze correction.",
      };
    }
  }

  let availabilityUpsertStatus:
    | "updated"
    | "unchanged"
    | "updated_context_only"
    | "skipped_already_correct"
    | null = null;

  if (freezeOnlyCorrection) {
    // Designation already correct — do not rewrite PWA; only stamp freezes.
    availabilityUpsertStatus = "skipped_already_correct";
  } else {
    // Bypass normal kickoff skip — this is the explicit exception path.
    const upsert = await upsertPlayerWeekAvailability({
      weekId: input.weekId,
      rankableEntryId: input.rankableEntryId,
      designation: input.designation,
      injuryDescription: `[Post-kickoff factual correction] ${reason}`,
      sourceUrl: sourceReference.startsWith("http")
        ? sourceReference
        : `correction:${sourceReference}`,
      sourcePublishedAt: sourcePublishedAt ?? now,
      observedAt: now,
      sourceType: "MANUAL",
      setManualOverride: true,
      respectManualOverride: false,
      skipAfterKickoff: false,
      updatedByUserId: input.adminUserId,
      now,
    });

    if (
      upsert.status !== "updated" &&
      upsert.status !== "unchanged" &&
      upsert.status !== "updated_context_only"
    ) {
      return {
        ok: false,
        error: "availability_write_failed",
        message: `Availability write failed (${upsert.status}).`,
      };
    }
    availabilityUpsertStatus = upsert.status;
  }

  // Count picks already correctly frozen (idempotency / audit).
  const alreadyFrozen = await prisma.rankingPick.count({
    where: {
      rankableEntryId: input.rankableEntryId,
      submission: { contest: { weekId: input.weekId } },
      wasUnavailableAtKickoff: true,
    },
  });

  // Stamp only missing / incorrect freezes — never touch predictedRank,
  // lockedAt, or reserveEligiblePredecessorIds. Idempotent on re-run.
  const pickUpdate = await prisma.rankingPick.updateMany({
    where: {
      rankableEntryId: input.rankableEntryId,
      submission: {
        contest: { weekId: input.weekId },
      },
      OR: [
        { wasUnavailableAtKickoff: null },
        { wasUnavailableAtKickoff: false },
      ],
    },
    data: {
      wasUnavailableAtKickoff: true,
    },
  });

  if (freezeOnlyCorrection && pickUpdate.count === 0) {
    return {
      ok: false,
      error: "nothing_to_correct",
      message:
        "Availability already correct and all week picks are already frozen unavailable — nothing to correct.",
    };
  }

  const contests = await prisma.rankIQContest.findMany({
    where: {
      weekId: input.weekId,
      entries: { some: { rankableEntryId: input.rankableEntryId } },
    },
    select: { id: true, position: true, status: true },
  });
  const affectedContestIds = contests.map((c) => c.id);
  const requiresRegrade = contests.some(
    (c) =>
      c.status === "FINAL" ||
      c.status === "GRADING" ||
      c.status === "ARCHIVED" ||
      c.status === "LIVE",
  );

  const audit = await logAdminAction({
    adminUserId: input.adminUserId,
    action: POST_KICKOFF_FACTUAL_CORRECTION_ACTION,
    entityType: "PlayerWeekAvailability",
    entityId: input.weekId,
    metadata: {
      rankableEntryId: input.rankableEntryId,
      playerName: entry.name,
      weekId: input.weekId,
      previousDesignation,
      correctedDesignation: input.designation,
      reason,
      sourceReference,
      sourcePublishedAt: sourcePublishedAt?.toISOString() ?? null,
      kickoffAt: kickoffAt.toISOString(),
      correctedAt: now.toISOString(),
      freezePicksUpdated: pickUpdate.count,
      freezePicksAlreadyCorrect: alreadyFrozen,
      freezeOnlyCorrection,
      availabilityUpsertStatus,
      affectedContestIds,
      requiresRegrade,
      regradeOccurred: false,
    },
  });

  return {
    ok: true,
    previousDesignation,
    correctedDesignation: input.designation,
    kickoffAt,
    freezePicksUpdated: pickUpdate.count,
    freezePicksAlreadyCorrect: alreadyFrozen,
    freezeOnlyCorrection,
    availabilityUpsertStatus,
    affectedContestIds,
    requiresRegrade,
    auditLogId: audit.id,
  };
}

/**
 * Mark that an admin subsequently regraded after a factual correction.
 * Appends a follow-up audit entry (does not mutate prior metadata).
 */
export async function logPostKickoffCorrectionRegrade(input: {
  adminUserId: string;
  weekId: string;
  contestIds: string[];
  correctionAuditLogId?: string | null;
}) {
  return logAdminAction({
    adminUserId: input.adminUserId,
    action: "week_status.post_kickoff_correction_regraded",
    entityType: "Week",
    entityId: input.weekId,
    metadata: {
      contestIds: input.contestIds,
      correctionAuditLogId: input.correctionAuditLogId ?? null,
      regradeOccurred: true,
      regradedAt: new Date().toISOString(),
    },
  });
}

/**
 * Server-authoritative contest set for post-correction regrade.
 * Does NOT trust browser-supplied contest IDs.
 *
 * Loads the correction audit, verifies week + action, then re-derives contests
 * that include the corrected RankableEntry for that week only.
 */
export async function resolveContestsForPostKickoffCorrectionRegrade(input: {
  weekId: string;
  correctionAuditLogId: string;
}): Promise<
  | {
      ok: true;
      contestIds: string[];
      rankableEntryId: string;
      correctionAuditLogId: string;
    }
  | { ok: false; message: string }
> {
  const auditId = input.correctionAuditLogId.trim();
  if (!auditId) {
    return {
      ok: false,
      message: "Correction audit ID is required to regrade safely.",
    };
  }

  const audit = await prisma.adminAuditLog.findUnique({
    where: { id: auditId },
  });
  if (!audit) {
    return { ok: false, message: "Correction audit record not found." };
  }
  if (audit.action !== POST_KICKOFF_FACTUAL_CORRECTION_ACTION) {
    return {
      ok: false,
      message: "Audit record is not a post-kickoff factual correction.",
    };
  }
  if (audit.entityId !== input.weekId) {
    return {
      ok: false,
      message: "Correction audit does not match the requested week.",
    };
  }

  const metadata =
    audit.metadata && typeof audit.metadata === "object"
      ? (audit.metadata as Record<string, unknown>)
      : null;
  const rankableEntryId =
    typeof metadata?.rankableEntryId === "string"
      ? metadata.rankableEntryId
      : null;
  const metadataWeekId =
    typeof metadata?.weekId === "string" ? metadata.weekId : null;

  if (!rankableEntryId) {
    return {
      ok: false,
      message: "Correction audit is missing rankableEntryId.",
    };
  }
  if (metadataWeekId && metadataWeekId !== input.weekId) {
    return {
      ok: false,
      message: "Correction audit week metadata mismatch.",
    };
  }

  // Re-derive affected contests on the server — never trust browser contest IDs.
  const contests = await prisma.rankIQContest.findMany({
    where: {
      weekId: input.weekId,
      entries: { some: { rankableEntryId } },
    },
    select: { id: true },
  });

  return {
    ok: true,
    contestIds: contests.map((c) => c.id),
    rankableEntryId,
    correctionAuditLogId: audit.id,
  };
}
