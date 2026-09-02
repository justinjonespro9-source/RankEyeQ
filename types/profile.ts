export type ProfileContestHistoryItem = {
  submissionId: string;
  contestId: string;
  weekLabel: string;
  weekNumber: number;
  position: "QB" | "RB" | "WR" | "TE" | "DEF";
  normalizedScore: number | null;
  rawScore: number | null;
  topNHits: number;
  exactHits: number;
  numberOneHit: boolean;
  weeklyRank: number | null;
};
