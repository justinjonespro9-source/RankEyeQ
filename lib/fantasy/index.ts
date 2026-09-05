/**
 * Shared FantasyTrack fantasy scoring — consumed by RankEyeQ and FantasyTrack.
 *
 * - Weekly fantasy points: lib/fantasy/player-scoring, defense-scoring
 * - Positional finishes: lib/fantasy/competition-rank via shared-engine
 * - RankEyeQ EYEQ ranking score: lib/scoring.ts (separate product metric)
 */

export {
  DEFAULT_FANTASY_SCORING_VERSION,
  FANTASYTRACK_NFL_HALF_PPR_V2,
  FANTASYTRACK_NFL_HALF_PPR_V1,
  FANTASYTRACK_NFL_FULL_PPR_V1,
  RANKIQ_NFL_PPR_V1,
  getFantasyRules,
  normalizeFantasyScoringVersion,
  isCanonicalNewWeekFantasyVersion,
  type PlayerFantasyScoringRules,
  type DefenseFantasyScoringRules,
  type FantasyScoringVersion,
} from "@/lib/fantasy/scoring-config";

export {
  fantasyTrackFantasyScoring,
  rankEyeQFantasyScoring,
  rankWeeklyFantasyFinishes,
  resolveFantasyScoringVersion,
  scoreWeeklyDefenseFantasy,
  scoreWeeklyPlayerFantasy,
} from "@/lib/fantasy/shared-engine";

export {
  getFantasyScoringReferenceTables,
  getFantasyScoringSummary,
} from "@/lib/fantasy/scoring-reference";

export { scorePlayerFantasy } from "@/lib/fantasy/player-scoring";
export { scoreDefenseFantasy } from "@/lib/fantasy/defense-scoring";
export { assignCompetitionRanks } from "@/lib/fantasy/competition-rank";
