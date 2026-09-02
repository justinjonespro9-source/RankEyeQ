import type { RankingScoringConfig } from "@/lib/ranking-scoring-version";
import {
  configActualPodiumBonus,
  configPrecisionBonus,
  getDefaultRankingScoringConfig,
  isPodiumPickWithConfig,
} from "@/lib/ranking-scoring-version";
import type {
  ContestScoreSummary,
  PlayerScoreBreakdown,
} from "@/types/scoring";

export const BASE_HIT_POINTS = 10;
export const PODIUM_CALL_BONUS = 10;
export const PODIUM_PICK_SLOTS = 3;

export const PRECISION_EXACT = 5;
export const PRECISION_OFF_BY_1 = 3;
export const PRECISION_OFF_BY_2 = 1;

/** Actual finish bonus when a player lands on the real weekly podium. */
export const ACTUAL_PODIUM_POINTS: Record<1 | 2 | 3, number> = {
  1: 20,
  2: 15,
  3: 10,
};

/** Perfect Top-10 board: 40 + 35 + 30 + (7 × 15) = 210 */
export const TOP_10_MAX_RAW = 210;

/** Perfect WR Top-15 board: 105 + (12 × 15) = 285 */
export const TOP_15_MAX_RAW = 285;

export type ScoreablePick = {
  playerId: string;
  playerName: string;
  predictedRank: number;
  actualRank: number;
};

export function isPodiumPick(predictedRank: number) {
  return predictedRank >= 1 && predictedRank <= PODIUM_PICK_SLOTS;
}

export function isActualPodium(actualRank: number) {
  return actualRank === 1 || actualRank === 2 || actualRank === 3;
}

/**
 * Fixed precision ladder for ranked predictions.
 * Not applied when a Podium Pick successfully calls the actual podium.
 */
export function precisionBonus(rankDifferenceAbs: number) {
  if (rankDifferenceAbs === 0) return PRECISION_EXACT;
  if (rankDifferenceAbs === 1) return PRECISION_OFF_BY_1;
  if (rankDifferenceAbs === 2) return PRECISION_OFF_BY_2;
  return 0;
}

/**
 * Bonus for where the player actually finished (competition ranking).
 * Skipped ranks (e.g. 1,2,2,4) award no #3 bonus for actual #4.
 */
export function actualPodiumBonus(actualRank: number) {
  if (actualRank === 1 || actualRank === 2 || actualRank === 3) {
    return ACTUAL_PODIUM_POINTS[actualRank];
  }
  return 0;
}

/**
 * RankEyeQ weekly ranking score for one pick.
 *
 * Podium picks (slots 1–3) form a pool: order within the Top 3 does not
 * affect the Podium Call bonus. A successful call suppresses precision points.
 */
export function scorePlayerPick(
  pick: ScoreablePick,
  fieldSize: number,
  config: RankingScoringConfig = getDefaultRankingScoringConfig(),
): PlayerScoreBreakdown {
  const { predictedRank, actualRank } = pick;
  const rankDifference = actualRank - predictedRank;
  const rankDifferenceAbs = Math.abs(rankDifference);
  const topNHit = actualRank >= 1 && actualRank <= fieldSize;
  const exactHit = topNHit && predictedRank === actualRank;
  const podiumPick = isPodiumPickWithConfig(config, predictedRank);
  const podiumCallHit = topNHit && podiumPick && isActualPodium(actualRank);
  const withinTwo = topNHit && rankDifferenceAbs <= 2;

  if (!topNHit) {
    return {
      playerId: pick.playerId,
      playerName: pick.playerName,
      predictedRank,
      actualRank,
      basePoints: 0,
      precisionPoints: 0,
      actualPodiumPoints: 0,
      podiumCallPoints: 0,
      accuracyPoints: 0,
      podiumPoints: 0,
      totalPoints: 0,
      rankDifference,
      exactHit: false,
      topNHit: false,
      podiumHit: false,
      podiumCallHit: false,
      withinTwo: false,
    };
  }

  const basePoints = config.baseHitPoints;
  const actualPodiumPoints = configActualPodiumBonus(config, actualRank);
  const podiumCallPoints = podiumCallHit ? config.podiumCallBonus : 0;
  const precisionPoints = podiumCallHit
    ? 0
    : configPrecisionBonus(config, rankDifferenceAbs);

  return {
    playerId: pick.playerId,
    playerName: pick.playerName,
    predictedRank,
    actualRank,
    basePoints,
    precisionPoints,
    actualPodiumPoints,
    podiumCallPoints,
    accuracyPoints: precisionPoints,
    podiumPoints: actualPodiumPoints + podiumCallPoints,
    totalPoints:
      basePoints + precisionPoints + actualPodiumPoints + podiumCallPoints,
    rankDifference,
    exactHit,
    topNHit,
    podiumHit: podiumCallHit,
    podiumCallHit,
    withinTwo,
  };
}

/** Perfect board maximum derived from the same pick rules (not hardcoded). */
export function getTheoreticalMaxScore(
  fieldSize: number,
  config: RankingScoringConfig = getDefaultRankingScoringConfig(),
): number {
  let total = 0;
  for (let rank = 1; rank <= fieldSize; rank += 1) {
    total += scorePlayerPick(
      {
        playerId: `max-${rank}`,
        playerName: `Rank ${rank}`,
        predictedRank: rank,
        actualRank: rank,
      },
      fieldSize,
      config,
    ).totalPoints;
  }
  return total;
}

export function normalizeRankIqScore(rawPoints: number, maxPoints: number) {
  if (maxPoints <= 0) return 0;
  return (rawPoints / maxPoints) * 100;
}

export function scoreContest(
  picks: ScoreablePick[],
  fieldSize: number,
  config: RankingScoringConfig = getDefaultRankingScoringConfig(),
): ContestScoreSummary {
  const players = picks.map((pick) => scorePlayerPick(pick, fieldSize, config));
  const rawPoints = players.reduce((sum, row) => sum + row.totalPoints, 0);
  const maxPoints = getTheoreticalMaxScore(fieldSize, config);
  const topNHits = players.filter((row) => row.topNHit).length;
  const exactHits = players.filter((row) => row.exactHit).length;
  const podiumHits = players.filter((row) => row.podiumHit).length;
  const withinTwoHits = players.filter((row) => row.withinTwo).length;
  const numberOneHit = players.some(
    (row) => row.actualRank === 1 && row.topNHit,
  );

  const qualifyingErrors = players
    .filter((row) => row.topNHit)
    .map((row) => Math.abs(row.rankDifference));

  const averageRankError =
    qualifyingErrors.length === 0
      ? null
      : qualifyingErrors.reduce((sum, value) => sum + value, 0) /
        qualifyingErrors.length;

  return {
    fieldSize,
    rawPoints,
    maxPoints,
    rankIqScore: normalizeRankIqScore(rawPoints, maxPoints),
    topNHits,
    exactHits,
    podiumHits,
    /** @deprecated Use podiumHits — kept for transitional callers */
    podiumPlayersIdentified: podiumHits,
    withinTwoHits,
    numberOneHit,
    averageRankError,
    players,
  };
}

export function formatRankIqScore(score: number) {
  return score.toFixed(1);
}

/** @deprecated Use precisionBonus */
export function accuracyBonus(_fieldSize: number, rankDifferenceAbs: number) {
  return precisionBonus(rankDifferenceAbs);
}

/** @deprecated Use actualPodiumBonus */
export function podiumBonus(actualRank: number) {
  return actualPodiumBonus(actualRank);
}

/** @deprecated Use ACTUAL_PODIUM_POINTS */
export const PODIUM_POINTS = ACTUAL_PODIUM_POINTS;
