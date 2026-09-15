import type { ContestPosition } from "@/lib/generated/prisma/client";
import type { Position } from "@/types/contest";

/** Ordered reserve slots appended after the scoring board (current production). */
export const RESERVE_COUNT = 2;

/**
 * Scoring depth (EYEQ field size). Unchanged by reserves:
 * QB/RB/TE/DEF = Top 10, WR = Top 15.
 */
export const RANKING_DEPTH_BY_POSITION: Record<ContestPosition, number> = {
  QB: 10,
  RB: 10,
  WR: 15,
  TE: 10,
  DEF: 10,
};

/** Alias: scoring board size used for EYEQ. */
export function scoringDepthForPosition(position: ContestPosition): number {
  return RANKING_DEPTH_BY_POSITION[position];
}

/** Historical name — scoring depth (not submission depth). */
export function rankingDepthForPosition(position: ContestPosition): number {
  return scoringDepthForPosition(position);
}

/**
 * Human/AI submission size for a contest.
 * Uses contest.reserveCount when provided — never invents today's global +2
 * for legacy contests that were submitted before reserves existed.
 */
export function submissionDepthForContest(input: {
  rankingDepth: number;
  reserveCount: number;
}): number {
  return submissionDepthFromScoring(input.rankingDepth, input.reserveCount);
}

/** Current-production Human/AI submission size (scoring + default reserves). */
export function submissionDepthForPosition(position: ContestPosition): number {
  return scoringDepthForPosition(position) + RESERVE_COUNT;
}

/**
 * Map scoring depth → max submission depth for a given reserveCount.
 * Nonstandard fixture depths (not 10/15) stay scoring-only.
 */
export function submissionDepthFromScoring(
  scoringDepth: number,
  reserveCount: number = RESERVE_COUNT,
): number {
  if (scoringDepth !== 10 && scoringDepth !== 15) {
    return scoringDepth;
  }
  return scoringDepth + Math.max(0, reserveCount);
}

export function isReservePredictedRank(
  predictedRank: number,
  scoringDepth: number,
): boolean {
  return predictedRank > scoringDepth;
}

export function reserveSlotNumber(
  predictedRank: number,
  scoringDepth: number,
): number | null {
  if (!isReservePredictedRank(predictedRank, scoringDepth)) return null;
  return predictedRank - scoringDepth;
}

/**
 * Accept boards from scoring-only depth up through scoring + reserveCount.
 * Legacy Week 1 (reserveCount=0): exactly Top 10 / Top 15 is complete.
 * Reserve-enabled (reserveCount=2): Top 10–12 / Top 15–17 are scorable
 * (experts may still publish scoring-only).
 */
export function isScorablePickCount(
  pickCount: number,
  scoringDepth: number,
  reserveCount: number = RESERVE_COUNT,
): boolean {
  const maxDepth = submissionDepthFromScoring(scoringDepth, reserveCount);
  return pickCount >= scoringDepth && pickCount <= maxDepth;
}

export function toUiPosition(position: ContestPosition): Position {
  return position.toLowerCase() as Position;
}

export function toDbPosition(position: Position): ContestPosition {
  return position.toUpperCase() as ContestPosition;
}

export const CONTEST_POSITIONS: ContestPosition[] = [
  "QB",
  "RB",
  "WR",
  "TE",
  "DEF",
];
