/**
 * Participation + performance thresholds for Phase 1 competitor badges.
 * Tune here — keep evaluators free of magic numbers.
 */
export const COMPETITOR_BADGE_THRESHOLDS = {
  /** Min graded contests (any position) for overall Top % badges */
  minOverallContests: 5,
  /** Min graded contests at a position for that position’s Top % badges */
  minPositionContests: 3,
  /** Exact Hit / Podium Call require at least one lifetime graded hit */
  minExactHits: 1,
  minPodiumCalls: 1,
  /** Hot Streak: consecutive weeks with weekly mean EYEQ at/above this */
  hotStreakMinWeeks: 3,
  hotStreakMinEyeq: 80,
} as const;

export const ATHLETE_BADGE_THRESHOLDS = {
  /** 3-Week Heater: consecutive graded weeks finishing at or better than this rank */
  heaterMinWeeks: 3,
  heaterMaxFinish: 10,
} as const;

/** Percentile cutoffs (rank must be within this share of the qualified cohort). */
export const PERCENTILE_CUTOFFS = {
  top1: 0.01,
  top5: 0.05,
  top10: 0.1,
} as const;
