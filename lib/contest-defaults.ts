import type { ContestPosition } from "@/lib/generated/prisma/client";
import type { Position } from "@/types/contest";

/** Ordered reserve slots appended after the scoring board. */
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

/** Human/AI submission size: scoring depth + ordered reserves. */
export function submissionDepthForPosition(position: ContestPosition): number {
  return scoringDepthForPosition(position) + RESERVE_COUNT;
}

export function submissionDepthFromScoring(scoringDepth: number): number {
  // Production EYEQ boards always include two ordered reserves.
  // Nonstandard depths (integration fixtures) stay scoring-only.
  if (scoringDepth === 10 || scoringDepth === 15) {
    return scoringDepth + RESERVE_COUNT;
  }
  return scoringDepth;
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

/** Accept boards with scoring-only depth or with 1–2 reserves (external sources). */
export function isScorablePickCount(
  pickCount: number,
  scoringDepth: number,
): boolean {
  return (
    pickCount >= scoringDepth &&
    pickCount <= submissionDepthFromScoring(scoringDepth)
  );
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
