/**
 * Waiver competitor categories for consensus and leaderboard comparisons.
 * Pure. HUMANS = owner-authored HUMAN/CREATOR boards; AI = system-operated
 * AI boards; ALL = both. Any other combination (BENCHMARK, captured or
 * mismatched authority) belongs to no category and is never counted.
 */

import type { WaiverBoardEntryBasis } from "@/lib/waivers/ai/constants";

export const WAIVER_COMPETITOR_CATEGORIES = ["HUMANS", "AI", "ALL"] as const;

export type WaiverCompetitorCategory = (typeof WAIVER_COMPETITOR_CATEGORIES)[number];

export type WaiverCategorizedBoard = { profileType: string; authority: string };

export function waiverBoardCategory(board: WaiverCategorizedBoard): "HUMANS" | "AI" | null {
  if (board.authority === "OWNER_AUTHORED" && (board.profileType === "HUMAN" || board.profileType === "CREATOR")) return "HUMANS";
  if (board.authority === "SYSTEM_OPERATED" && board.profileType === "AI") return "AI";
  return null;
}

export function boardInWaiverCategory(board: WaiverCategorizedBoard, category: WaiverCompetitorCategory): boolean {
  const own = waiverBoardCategory(board);
  if (own === null) return false;
  return category === "ALL" || own === category;
}

export function filterWaiverBoardsByCategory<T extends WaiverCategorizedBoard>(boards: ReadonlyArray<T>, category: WaiverCompetitorCategory): T[] {
  return boards.filter((board) => boardInWaiverCategory(board, category));
}

/**
 * How a competitive board entered its contest. Only AI boards can be
 * late-entered or overridden (database-enforced); every board in the HUMANS
 * category is ON_TIME. AI and ALL views must show the non-ON_TIME
 * designations (WAIVER_BOARD_ENTRY_BASIS_LABELS) beside the board.
 */
export function waiverBoardEntryBasis(board: { lateEntry: object | null; competitiveOverride: object | null }): WaiverBoardEntryBasis {
  if (board.competitiveOverride) return "ADMIN_COMPETITIVE_OVERRIDE";
  if (board.lateEntry) return "VERIFIED_LATE_ENTRY";
  return "ON_TIME";
}

export function parseWaiverCompetitorCategory(raw: string | undefined | null): WaiverCompetitorCategory {
  const value = raw?.toUpperCase();
  return (WAIVER_COMPETITOR_CATEGORIES as readonly string[]).includes(value ?? "") ? (value as WaiverCompetitorCategory) : "HUMANS";
}
