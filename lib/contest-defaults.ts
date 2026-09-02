import type { ContestPosition } from "@/lib/generated/prisma/client";
import type { Position } from "@/types/contest";

export const RANKING_DEPTH_BY_POSITION: Record<ContestPosition, number> = {
  QB: 10,
  RB: 10,
  WR: 15,
  TE: 10,
  DEF: 10,
};

export function rankingDepthForPosition(position: ContestPosition): number {
  return RANKING_DEPTH_BY_POSITION[position];
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
