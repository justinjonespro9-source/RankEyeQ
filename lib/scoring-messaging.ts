/** Public copy for the RankEyeQ weekly scoring model. */

export const SCORING_HEADLINE =
  "Pick the players you believe will finish at the top this week.";

export const SCORING_FIND_THE_FIELD =
  "Every player you correctly put inside the actual Top 10 (Top 15 for WR) earns points.";

export const SCORING_CALL_THE_PODIUM =
  "Your first 3 slots are your Podium Picks. If any of them actually finish Top 3, you earn a Podium Call bonus — order within your Top 3 does not matter.";

export const SCORING_RANK_THE_REST =
  "For the rest of your board, exact rankings and near-misses earn extra precision points.";

export const SCORING_PODIUM_HELPER =
  "Your Top 3 are your Podium Picks. Any of them that finish Top 3 earn a Podium Call bonus.";

export const SCORING_TABLE_ROWS = [
  { label: "Top-N Hit", value: "+10" },
  { label: "Precision — exact", value: "+5" },
  { label: "Precision — off by 1", value: "+3" },
  { label: "Precision — off by 2", value: "+1" },
  { label: "Actual podium — #1", value: "+20" },
  { label: "Actual podium — #2", value: "+15" },
  { label: "Actual podium — #3", value: "+10" },
  { label: "Podium Call", value: "+10" },
] as const;
