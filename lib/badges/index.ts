export type {
  BadgeCategory,
  BadgeDefinition,
  BadgeFamily,
  BadgeId,
  EarnedBadge,
} from "@/lib/badges/types";
export {
  getBadgeDefinition,
  listAthleteBadgeDefinitions,
  listCompetitorBadgeDefinitions,
  listPhase1BadgeDefinitions,
  listReservedBadgeCategories,
} from "@/lib/badges/catalog";
export {
  COMPETITOR_BADGE_THRESHOLDS,
  ATHLETE_BADGE_THRESHOLDS,
  PERCENTILE_CUTOFFS,
} from "@/lib/badges/thresholds";
export {
  maxRankForPercentile,
  qualifiesForTopPercentile,
  qualifyLeaderboardRows,
} from "@/lib/badges/percentile";
export {
  detectHotStreak,
  evaluateCompetitorBadges,
  evaluateCompetitorHitAndStreakBadges,
  evaluatePercentileBadges,
  getCompetitorBadgesForProfile,
} from "@/lib/badges/competitor";
export {
  detectThreeWeekHeater,
  evaluateAthleteBadges,
} from "@/lib/badges/athlete";
