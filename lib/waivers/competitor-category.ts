/**
 * Waiver competitor categories for consensus and leaderboard comparisons.
 * Pure. HUMANS = owner-authored HUMAN/CREATOR boards; AI = system-operated
 * AI boards; ALL = both. Any other combination (BENCHMARK, captured or
 * mismatched authority) belongs to no category and is never counted.
 */

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

export function parseWaiverCompetitorCategory(raw: string | undefined | null): WaiverCompetitorCategory {
  const value = raw?.toUpperCase();
  return (WAIVER_COMPETITOR_CATEGORIES as readonly string[]).includes(value ?? "") ? (value as WaiverCompetitorCategory) : "HUMANS";
}
