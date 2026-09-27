/**
 * Kickoff-time evidence resolver for RankingPick.wasUnavailableAtKickoff.
 *
 * Pure and deterministic: the answer depends only on persisted evidence rows
 * and the player's week-scoped kickoff. Evidence persisted after kickoff is
 * never used to reconstruct availability at kickoff — except an audited
 * post-kickoff factual correction, the explicit Admin exception path.
 *
 * Precedence is unchanged from resolvePlayerWeekStatus:
 * Admin override > roster hard-unavailable > weekly designation.
 * QUESTIONABLE / DOUBTFUL / UNKNOWN / practice status never freeze unavailable.
 */
import {
  resolvePlayerWeekStatus,
  type ResolvedPlayerWeekStatus,
  type WeeklyDesignation,
} from "@/lib/eligibility/player-week-availability";
import type { WeeklyAvailabilitySourceType } from "@/lib/generated/prisma/client";
import { freezeUnavailableFromWeekStatus } from "@/lib/reserves/kickoff-freeze";

export type KickoffWeekAvailabilityEvidence = {
  designation: WeeklyDesignation | string;
  injuryDescription?: string | null;
  practiceStatus?: string | null;
  sourceType?: WeeklyAvailabilitySourceType | null;
  sourceUrl?: string | null;
  sourcePublishedAt?: Date | null;
  observedAt: Date;
  manualOverride: boolean;
  /** Persisted write time of the PlayerWeekAvailability row. */
  updatedAt: Date;
};

export type KickoffRosterEvidence = {
  nflStatus: string | null;
  /** Persisted write time of the SeasonPlayer row (status history is not kept). */
  updatedAt: Date;
};

export type KickoffFactualCorrectionEvidence = {
  designation: string;
  correctedAt: Date;
};

export type KickoffFreezeSource =
  | "post_kickoff_factual_correction"
  | "admin_override"
  | "roster_hard_unavailable"
  | "weekly_designation"
  | "none";

export type KickoffFreezeIgnoredEvidence =
  | "roster_updated_after_kickoff"
  | "weekly_updated_after_kickoff";

export type KickoffFreezeDecision = {
  unavailable: boolean;
  source: KickoffFreezeSource;
  /** e.g. "OUT", "INACTIVE", "IR"; null when available. */
  reason: string | null;
  ignored: KickoffFreezeIgnoredEvidence[];
  resolved: ResolvedPlayerWeekStatus;
};

const FACTUAL_CORRECTION_DESIGNATIONS = new Set(["OUT", "INACTIVE"]);

function atOrBefore(value: Date, kickoffAt: Date): boolean {
  return value.getTime() <= kickoffAt.getTime();
}

export function resolveKickoffFreeze(input: {
  kickoffAt: Date;
  weekRow?: KickoffWeekAvailabilityEvidence | null;
  roster?: KickoffRosterEvidence | null;
  factualCorrection?: KickoffFactualCorrectionEvidence | null;
}): KickoffFreezeDecision {
  const { kickoffAt } = input;
  const ignored: KickoffFreezeIgnoredEvidence[] = [];

  const weekRow = input.weekRow ?? null;
  const weekUsable =
    weekRow != null &&
    atOrBefore(weekRow.updatedAt, kickoffAt) &&
    atOrBefore(weekRow.observedAt, kickoffAt);
  if (weekRow && !weekUsable) ignored.push("weekly_updated_after_kickoff");

  const roster = input.roster ?? null;
  const rosterUsable = roster != null && atOrBefore(roster.updatedAt, kickoffAt);
  if (roster && !rosterUsable) ignored.push("roster_updated_after_kickoff");

  const resolved = resolvePlayerWeekStatus({
    nflStatus: rosterUsable ? roster.nflStatus : null,
    weekDesignation: weekUsable
      ? (weekRow.designation as WeeklyDesignation)
      : undefined,
    injuryDescription: weekUsable ? weekRow.injuryDescription : null,
    practiceStatus: weekUsable ? weekRow.practiceStatus : null,
    sourceType: weekUsable ? weekRow.sourceType : null,
    sourceUrl: weekUsable ? weekRow.sourceUrl : null,
    sourcePublishedAt: weekUsable ? weekRow.sourcePublishedAt : null,
    observedAt: weekUsable ? weekRow.observedAt : null,
    manualOverride: weekUsable ? weekRow.manualOverride : false,
  });

  const correction = input.factualCorrection ?? null;
  const correctionDesignation = correction?.designation.trim().toUpperCase();
  if (
    correctionDesignation &&
    FACTUAL_CORRECTION_DESIGNATIONS.has(correctionDesignation)
  ) {
    return {
      unavailable: true,
      source: "post_kickoff_factual_correction",
      reason: correctionDesignation,
      ignored,
      resolved,
    };
  }

  const unavailable = freezeUnavailableFromWeekStatus(resolved);
  let source: KickoffFreezeSource = "none";
  if (unavailable) {
    if (resolved.manualOverride && weekUsable) source = "admin_override";
    else if (resolved.rosterUnavailable) source = "roster_hard_unavailable";
    else source = "weekly_designation";
  }

  return {
    unavailable,
    source,
    reason: unavailable ? resolved.unavailableReason : null,
    ignored,
    resolved,
  };
}
