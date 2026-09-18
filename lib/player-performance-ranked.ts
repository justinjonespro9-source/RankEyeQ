/**
 * Player-performance Ranked % / Avg Rank (scoring-board only).
 *
 * Snapshot selectionRate* / selectedCount* are ANY-SLOT (includes reserves).
 * Consensus Selected % must remain that any-slot metric unchanged.
 *
 * Ranked % is computed at read time from eligible official RankingSubmissions
 * (Human + Creator + Expert + Publisher + AI) with predictedRank <= scoring
 * depth. Not group-weighted Consensus “All.” No migration.
 */

import type { ContestPosition } from "@/lib/generated/prisma/client";
import { rankingDepthForPosition } from "@/lib/contest-defaults";

export const RANKED_PCT_LABEL = "Ranked % — All Official Rankers";

export const RANKED_PCT_TOOLTIP =
  "How often eligible official boards put the player on a scoring board. Every Human, Creator, Expert, Publisher, and AI board that covers this position counts once — not the group-weighted Consensus All.";

export const AVG_RANK_TOOLTIP =
  "Average scoring position when ranked by eligible official boards (reserves excluded).";

export type ScoringBoardPickInput = {
  rankableEntryId: string;
  predictedRank: number;
};

export type EligibleBallotInput = {
  picks: ScoringBoardPickInput[];
};

/**
 * Scoring field size for Ranked % — contest.rankingDepth when known,
 * otherwise position default (WR 15, others 10).
 */
export function scoringDepthForRankedMetric(
  position: ContestPosition,
  contestRankingDepth?: number | null,
): number {
  if (
    typeof contestRankingDepth === "number" &&
    contestRankingDepth > 0
  ) {
    return contestRankingDepth;
  }
  return rankingDepthForPosition(position);
}

export function isScoringBoardRank(
  predictedRank: number,
  scoringDepth: number,
): boolean {
  return predictedRank >= 1 && predictedRank <= scoringDepth;
}

/**
 * Per-contest tallies for one player against a set of eligible official ballots.
 * Unselected ballots still count in the denominator.
 */
export function tallyScoringBoardSelection(input: {
  rankableEntryId: string;
  scoringDepth: number;
  eligibleBallots: EligibleBallotInput[];
}): {
  eligibleBallotCount: number;
  scoringBoardSelections: number;
  scoringRankSum: number;
} {
  const eligibleBallotCount = input.eligibleBallots.length;
  let scoringBoardSelections = 0;
  let scoringRankSum = 0;

  for (const ballot of input.eligibleBallots) {
    const pick = ballot.picks.find(
      (row) => row.rankableEntryId === input.rankableEntryId,
    );
    if (!pick) continue;
    if (!isScoringBoardRank(pick.predictedRank, input.scoringDepth)) {
      // Reserve-only (or invalid) placement does not count.
      continue;
    }
    scoringBoardSelections += 1;
    scoringRankSum += pick.predictedRank;
  }

  return {
    eligibleBallotCount,
    scoringBoardSelections,
    scoringRankSum,
  };
}

/** Summed Ranked % across contests — never average of weekly percentages. */
export function rankedPctFromSums(
  scoringBoardSelections: number,
  eligibleBallotCount: number,
): number | null {
  if (eligibleBallotCount <= 0) return null;
  return scoringBoardSelections / eligibleBallotCount;
}

/** Avg scoring rank among scoring-board selections only. */
export function avgRankedPositionFromSums(
  scoringRankSum: number,
  scoringBoardSelections: number,
): number | null {
  if (scoringBoardSelections <= 0) return null;
  return scoringRankSum / scoringBoardSelections;
}

export function formatRankedPct(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

export function formatAvgRank(value: number | null): string {
  if (value == null) return "—";
  return value.toFixed(1);
}

export function topNThresholdForPosition(position: ContestPosition): number {
  return position === "WR" ? 15 : 10;
}

export function topNLabelForPosition(position: ContestPosition | "ALL"): string {
  if (position === "WR") return "Top 15";
  if (position === "ALL") return "Top 10/15";
  return "Top 10";
}
