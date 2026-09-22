/**
 * Post-Kickoff Factual Correction — admin-only exception path.
 *
 * Ordinary availability writes keep skipAfterKickoff: true.
 * This workflow:
 *  1. Writes OUT/INACTIVE despite kickoff (authorized only).
 *  2. Revises RankingPick.wasUnavailableAtKickoff so deriveEffectiveBoard
 *     displaces the player after kickoff (original predictedRank unchanged).
 *  3. Does NOT auto-regrade — operator must regrade explicitly.
 *  4. Does NOT rewrite consensus / pregame snapshots.
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

function kickoffForWeekEntry(input: {
  contestEntries: Array<{
    game: { startsAt: Date; weekId: string | null } | null;
  }>;
}, weekId: string): Date | null {
  const contestGame = input.contestEntries[0]?.game ?? null;
  if (contestGame && contestGame.weekId === weekId) {
    return contestGame.startsAt;
  }
  return null;
}

export type ApplyPostKickoffFactualCorrectionInput = {
  weekId: string;
  rankableEntryId: string;
  designation: PostKickoffCorrectionDesignation;
  /** Required operator reason (why this factual correction is authorized). */
  reason: string;
  /** Factual source URL or free-text reference. */
  sourceReference: string;
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
        | "kickoff_not_passed"
        | "kickoff_unknown"
        | "player_not_found";
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

  // Bypass normal kickoff skip — this is the explicit exception path.
  const upsert = await upsertPlayerWeekAvailability({
    weekId: input.weekId,
    rankableEntryId: input.rankableEntryId,
    designation: input.designation,
    injuryDescription: `[Post-kickoff factual correction] ${reason}`,
    sourceUrl: sourceReference.startsWith("http")
      ? sourceReference
      : `correction:${sourceReference}`,
    sourcePublishedAt: now,
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
    upsert.status !== "unchanged"
  ) {
    // Should not happen with skipAfterKickoff: false; surface conservatively.
    return {
      ok: false,
      error: "kickoff_not_passed",
      message: `Availability write failed (${upsert.status}).`,
    };
  }

  // Revise freeze so post-kickoff deriveEffectiveBoard displaces this player.
  // Never touch predictedRank or reserveEligiblePredecessorIds.
  const pickUpdate = await prisma.rankingPick.updateMany({
    where: {
      rankableEntryId: input.rankableEntryId,
      submission: {
        contest: { weekId: input.weekId },
      },
    },
    data: {
      wasUnavailableAtKickoff: true,
    },
  });

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
      kickoffAt: kickoffAt.toISOString(),
      correctedAt: now.toISOString(),
      freezePicksUpdated: pickUpdate.count,
      affectedContestIds,
      requiresRegrade,
      regradeOccurred: false,
      upsertStatus: upsert.status,
    },
  });

  return {
    ok: true,
    previousDesignation,
    correctedDesignation: input.designation,
    kickoffAt,
    freezePicksUpdated: pickUpdate.count,
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
