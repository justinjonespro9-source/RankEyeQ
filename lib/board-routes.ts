import type { ContestPosition } from "@/lib/generated/prisma/client";

/**
 * `?season=YYYY` on `/profile/[username]/rankings/[week]/[position]`.
 * Absent → the active season (legacy links). Present but malformed → "invalid".
 */
export function parseSeasonYearParam(value: unknown): number | null | "invalid" {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}$/.test(value)) return "invalid";
  return Number(value);
}

/**
 * Season filter for resolving a week number. A season year pins the lookup to
 * that season (`@@unique([year, sport])`) so historical receipts never drift to
 * the same-numbered week of a later active season.
 */
export function boardSeasonWhere<T extends object>(
  seasonYear: number | null | undefined,
  activeWhere: T,
): { year: number; sport: string } | T {
  return seasonYear != null ? { year: seasonYear, sport: "NFL" } : activeWhere;
}

export function profileBoardHref(
  username: string,
  seasonYear: number,
  weekNumber: number,
  position: ContestPosition,
): string {
  return `/profile/${username}/rankings/${weekNumber}/${position.toLowerCase()}?season=${seasonYear}`;
}

export function weeklyReceiptsAnchorId(seasonYear: number, weekNumber: number): string {
  return `season-${seasonYear}-week-${weekNumber}`;
}

export function weeklyReceiptsHref(
  username: string,
  seasonYear: number,
  weekNumber: number,
): string {
  return `/profile/${username}?tab=rankiq#${weeklyReceiptsAnchorId(seasonYear, weekNumber)}`;
}
