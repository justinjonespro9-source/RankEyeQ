/**
 * Public scoring copy derived from production engines:
 * - Fantasy: lib/fantasy/scoring-config.ts + player/defense scoring
 * - EYEQ: lib/scoring.ts
 * Do not invent bonuses or point values here — import constants.
 */

import {
  getFantasyScoringReferenceTables,
  getFantasyScoringSummary,
} from "@/lib/fantasy/scoring-reference";
import {
  ACTUAL_PODIUM_POINTS,
  BASE_HIT_POINTS,
  PODIUM_CALL_BONUS,
  PRECISION_EXACT,
  PRECISION_OFF_BY_1,
  PRECISION_OFF_BY_2,
  TOP_10_MAX_RAW,
  TOP_15_MAX_RAW,
  scorePlayerPick,
} from "@/lib/scoring";

export const SCORING_HEADLINE =
  "Pick the players you believe will finish at the top this week.";

export const SCORING_FIND_THE_FIELD =
  `Every player you correctly put inside the actual Top 10 (Top 15 for WR) earns +${BASE_HIT_POINTS}.`;

export const SCORING_CALL_THE_PODIUM =
  `Your first 3 slots are your Podium Picks. If any of them actually finish Top 3, you earn a +${PODIUM_CALL_BONUS} Podium Call bonus — order within your Top 3 does not matter.`;

export const SCORING_RANK_THE_REST =
  `For the rest of your board, exact rankings and near-misses earn precision points (+${PRECISION_EXACT} / +${PRECISION_OFF_BY_1} / +${PRECISION_OFF_BY_2}).`;

export const SCORING_PODIUM_HELPER =
  `Your Top 3 are your Podium Picks. Any of them that finish Top 3 earn a +${PODIUM_CALL_BONUS} Podium Call bonus.`;

export const SCORING_TABLE_ROWS = [
  { label: "Top-N Hit", value: `+${BASE_HIT_POINTS}` },
  { label: "Precision — exact", value: `+${PRECISION_EXACT}` },
  { label: "Precision — off by 1", value: `+${PRECISION_OFF_BY_1}` },
  { label: "Precision — off by 2", value: `+${PRECISION_OFF_BY_2}` },
  { label: "Actual podium — #1", value: `+${ACTUAL_PODIUM_POINTS[1]}` },
  { label: "Actual podium — #2", value: `+${ACTUAL_PODIUM_POINTS[2]}` },
  { label: "Actual podium — #3", value: `+${ACTUAL_PODIUM_POINTS[3]}` },
  { label: "Podium Call", value: `+${PODIUM_CALL_BONUS}` },
] as const;

export function eyeqFieldLabel(slotCount: number) {
  return slotCount === 15 ? "Top 15" : "Top 10";
}

export function eyeqMaxRaw(slotCount: number) {
  return slotCount === 15 ? TOP_15_MAX_RAW : TOP_10_MAX_RAW;
}

export function getCompactEyeqExplanation(slotCount: number) {
  const field = eyeqFieldLabel(slotCount);
  const maxRaw = eyeqMaxRaw(slotCount);
  return [
    `Rank ${field} for this position. EYEQ Score = raw points ÷ ${maxRaw} × 100.`,
    `Top-N Hit +${BASE_HIT_POINTS} when a pick finishes inside the actual ${field}. Finishes outside ${field} score 0 for that pick.`,
    `Podium Picks (slots 1–3): +${PODIUM_CALL_BONUS} if that player finishes actual #1–#3 (order among your Top 3 does not matter). Successful Podium Calls skip precision points.`,
    `Actual finish bonuses: #1 +${ACTUAL_PODIUM_POINTS[1]}, #2 +${ACTUAL_PODIUM_POINTS[2]}, #3 +${ACTUAL_PODIUM_POINTS[3]}.`,
    `Precision (when not a successful Podium Call): exact +${PRECISION_EXACT}, off by 1 +${PRECISION_OFF_BY_1}, off by 2 +${PRECISION_OFF_BY_2}.`,
  ];
}

export function getCompactFantasyScoringBullets() {
  const { offenseRows, defenseRows } = getFantasyScoringReferenceTables();
  const summary = getFantasyScoringSummary();
  return {
    formatLabel: summary.formatLabel,
    summary: summary.summary,
    offenseRows,
    defenseRows,
  };
}

export type EyeqWorkedExamplePick = {
  label: string;
  predictedRank: number;
  actualRank: number;
  totalPoints: number;
  note: string;
};

/**
 * Worked Top-10 example — point totals come from scorePlayerPick (production engine).
 */
export function getEyeqWorkedExample(): {
  fieldSize: number;
  maxRaw: number;
  picks: EyeqWorkedExamplePick[];
  rawTotal: number;
  eyeqScore: number;
  narrative: string[];
} {
  const fieldSize = 10;
  const cases: Array<{
    label: string;
    predictedRank: number;
    actualRank: number;
    note: string;
  }> = [
    {
      label: "Your #1 → actual #1",
      predictedRank: 1,
      actualRank: 1,
      note: `Top-N +${BASE_HIT_POINTS}, actual #1 +${ACTUAL_PODIUM_POINTS[1]}, Podium Call +${PODIUM_CALL_BONUS} (precision suppressed)`,
    },
    {
      label: "Your #2 → actual #4",
      predictedRank: 2,
      actualRank: 4,
      note: `Inside field: +${BASE_HIT_POINTS}, off by 2 precision +${PRECISION_OFF_BY_2} (missed podium)`,
    },
    {
      label: "Your #5 → actual #5",
      predictedRank: 5,
      actualRank: 5,
      note: `Top-N +${BASE_HIT_POINTS}, exact precision +${PRECISION_EXACT}`,
    },
    {
      label: "Your #8 → actual #18",
      predictedRank: 8,
      actualRank: 18,
      note: "Actual finish outside Top 10 → 0 for this pick",
    },
  ];

  const picks = cases.map((row) => {
    const scored = scorePlayerPick(
      {
        playerId: `${row.predictedRank}-${row.actualRank}`,
        playerName: row.label,
        predictedRank: row.predictedRank,
        actualRank: row.actualRank,
      },
      fieldSize,
    );
    return {
      label: row.label,
      predictedRank: row.predictedRank,
      actualRank: row.actualRank,
      totalPoints: scored.totalPoints,
      note: row.note,
    };
  });

  const rawTotal = picks.reduce((sum, pick) => sum + pick.totalPoints, 0);
  const maxRaw = TOP_10_MAX_RAW;
  const eyeqScore = (rawTotal / maxRaw) * 100;

  return {
    fieldSize,
    maxRaw,
    picks,
    rawTotal,
    eyeqScore,
    narrative: [
      `These four picks alone would contribute ${rawTotal} raw points.`,
      `A perfect Top-10 board scores ${maxRaw} raw → 100.0 EYEQ.`,
      `EYEQ for this fragment: ${rawTotal} ÷ ${maxRaw} × 100 = ${eyeqScore.toFixed(1)}.`,
      "Tied fantasy points use competition ranking (e.g. 1, 2, 2, 4) — equal scores share a rank and the next rank skips.",
    ],
  };
}
