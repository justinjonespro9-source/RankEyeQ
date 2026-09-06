import type { ContestPosition } from "@/lib/generated/prisma/client";

/** Badge families share one visual system; categories stay extensible. */
export type BadgeFamily = "competitor" | "athlete";

/**
 * Phase 1 categories plus reserved slots for monthly / market badges.
 * Add definitions in the catalog — evaluators can ignore unknown categories.
 */
export type BadgeCategory =
  | "season_percentile"
  | "hit"
  | "streak"
  | "finish"
  | "monthly"
  | "market";

export type CompetitorBadgeId =
  | "TOP_1_OVERALL"
  | "TOP_5_OVERALL"
  | "TOP_10_OVERALL"
  | "TOP_1_QB"
  | "TOP_5_QB"
  | "TOP_10_QB"
  | "TOP_1_RB"
  | "TOP_5_RB"
  | "TOP_10_RB"
  | "TOP_1_WR"
  | "TOP_5_WR"
  | "TOP_10_WR"
  | "TOP_1_TE"
  | "TOP_5_TE"
  | "TOP_10_TE"
  | "TOP_1_DEF"
  | "TOP_5_DEF"
  | "TOP_10_DEF"
  | "EXACT_HIT"
  | "PODIUM_CALL"
  | "HOT_STREAK";

export type AthleteBadgeId =
  | "POSITION_WINNER"
  | "PODIUM_FINISH"
  | "TOP_10_FINISH"
  | "THREE_WEEK_HEATER";

export type BadgeId = CompetitorBadgeId | AthleteBadgeId;

export type BadgeDefinition = {
  id: BadgeId;
  family: BadgeFamily;
  category: BadgeCategory;
  /** Full display label */
  label: string;
  /** Compact chip label */
  shortLabel: string;
  description: string;
  phase: 1 | 2;
  /** Optional position scope for by-position competitor badges */
  position?: ContestPosition;
  /** Top-X% threshold (0.01 = Top 1%) */
  percentile?: number;
};

export type EarnedBadge = {
  id: BadgeId;
  definition: BadgeDefinition;
  earnedAtLabel: string | null;
  detail: string | null;
};

export type BadgeEvaluationContext = {
  /** Human-readable season / window for UI */
  seasonLabel?: string | null;
};
