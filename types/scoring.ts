export type PlayerScoreBreakdown = {
  playerId: string;
  playerName: string;
  predictedRank: number;
  actualRank: number;
  basePoints: number;
  /** Precision ladder points (+5 / +3 / +1 / 0). */
  precisionPoints: number;
  /** Actual weekly podium finish bonus (#1 +20, #2 +15, #3 +10). */
  actualPodiumPoints: number;
  /** +10 when a Podium Pick (slots 1–3) finishes actual Top 3. */
  podiumCallPoints: number;
  /** Alias of precisionPoints — persisted on RankingPick.accuracyPoints. */
  accuracyPoints: number;
  /** actualPodiumPoints + podiumCallPoints — persisted on RankingPick.podiumPoints. */
  podiumPoints: number;
  totalPoints: number;
  rankDifference: number;
  exactHit: boolean;
  topNHit: boolean;
  /** Podium Pick that finished actual Top 3. */
  podiumHit: boolean;
  podiumCallHit: boolean;
  withinTwo: boolean;
};

export type ContestScoreSummary = {
  fieldSize: number;
  rawPoints: number;
  maxPoints: number;
  rankIqScore: number;
  topNHits: number;
  exactHits: number;
  /** User Podium Picks (slots 1–3) that finished actual Top 3. Max 3. */
  podiumHits: number;
  /** @deprecated Use podiumHits */
  podiumPlayersIdentified: number;
  withinTwoHits: number;
  numberOneHit: boolean;
  /** Mean absolute rank error across Top-N hits only; null if no hits. */
  averageRankError: number | null;
  players: PlayerScoreBreakdown[];
};
