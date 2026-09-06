import type { ReceiptPickLine } from "@/lib/profile-receipt";

export type ProfileContestHistoryItem = {
  submissionId: string;
  contestId: string;
  weekLabel: string;
  weekNumber: number;
  position: "QB" | "RB" | "WR" | "TE" | "DEF";
  rankingDepth: number;
  normalizedScore: number | null;
  rawScore: number | null;
  topNHits: number;
  exactHits: number;
  numberOneHit: boolean;
  weeklyRank: number | null;
  /** Graded pick lines for expandable Weekly Receipts (permanent archive). */
  receiptPicks: ReceiptPickLine[];
};
