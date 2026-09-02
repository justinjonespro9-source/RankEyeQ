import {
  ACTUAL_PODIUM_POINTS,
  BASE_HIT_POINTS,
  PODIUM_CALL_BONUS,
  PODIUM_PICK_SLOTS,
  PRECISION_EXACT,
  PRECISION_OFF_BY_1,
  PRECISION_OFF_BY_2,
} from "@/lib/scoring";

export type RankingScoringConfig = {
  baseHitPoints: number;
  podiumCallBonus: number;
  podiumPickSlots: number;
  precisionExact: number;
  precisionOffBy1: number;
  precisionOffBy2: number;
  actualPodiumPoints: Record<"1" | "2" | "3", number>;
};

export const RANKEYEQ_V1_SLUG = "rankeyeq-v1";

/** Default production config — must match seeded RankingScoringVersion row. */
export function getDefaultRankingScoringConfig(): RankingScoringConfig {
  return {
    baseHitPoints: BASE_HIT_POINTS,
    podiumCallBonus: PODIUM_CALL_BONUS,
    podiumPickSlots: PODIUM_PICK_SLOTS,
    precisionExact: PRECISION_EXACT,
    precisionOffBy1: PRECISION_OFF_BY_1,
    precisionOffBy2: PRECISION_OFF_BY_2,
    actualPodiumPoints: {
      "1": ACTUAL_PODIUM_POINTS[1],
      "2": ACTUAL_PODIUM_POINTS[2],
      "3": ACTUAL_PODIUM_POINTS[3],
    },
  };
}

export function parseRankingScoringConfig(raw: unknown): RankingScoringConfig {
  const fallback = getDefaultRankingScoringConfig();
  if (!raw || typeof raw !== "object") return fallback;
  const value = raw as Record<string, unknown>;
  const podium = value.actualPodiumPoints as Record<string, number> | undefined;
  return {
    baseHitPoints: Number(value.baseHitPoints) || fallback.baseHitPoints,
    podiumCallBonus: Number(value.podiumCallBonus) || fallback.podiumCallBonus,
    podiumPickSlots: Number(value.podiumPickSlots) || fallback.podiumPickSlots,
    precisionExact: Number(value.precisionExact) || fallback.precisionExact,
    precisionOffBy1: Number(value.precisionOffBy1) || fallback.precisionOffBy1,
    precisionOffBy2: Number(value.precisionOffBy2) || fallback.precisionOffBy2,
    actualPodiumPoints: {
      "1": Number(podium?.["1"]) || fallback.actualPodiumPoints["1"],
      "2": Number(podium?.["2"]) || fallback.actualPodiumPoints["2"],
      "3": Number(podium?.["3"]) || fallback.actualPodiumPoints["3"],
    },
  };
}

export function configPrecisionBonus(
  config: RankingScoringConfig,
  rankDifferenceAbs: number,
) {
  if (rankDifferenceAbs === 0) return config.precisionExact;
  if (rankDifferenceAbs === 1) return config.precisionOffBy1;
  if (rankDifferenceAbs === 2) return config.precisionOffBy2;
  return 0;
}

export function configActualPodiumBonus(
  config: RankingScoringConfig,
  actualRank: number,
) {
  if (actualRank === 1) return config.actualPodiumPoints["1"];
  if (actualRank === 2) return config.actualPodiumPoints["2"];
  if (actualRank === 3) return config.actualPodiumPoints["3"];
  return 0;
}

export function isPodiumPickWithConfig(
  config: RankingScoringConfig,
  predictedRank: number,
) {
  return predictedRank >= 1 && predictedRank <= config.podiumPickSlots;
}
