type WeekLike = { weekNumber: number; status: string };

const CURRENT_WEEK_STATUS_PRIORITY = ["OPEN", "LOCKED", "COMPLETE"] as const;

/**
 * The week public surfaces treat as "this week": the latest OPEN week, else the
 * latest LOCKED week, else the latest COMPLETE week, else the earliest week.
 * Independent of input order.
 */
export function selectCurrentWeek<T extends WeekLike>(
  weeks: readonly T[],
): T | null {
  for (const status of CURRENT_WEEK_STATUS_PRIORITY) {
    let latest: T | null = null;
    for (const week of weeks) {
      if (week.status !== status) continue;
      if (!latest || week.weekNumber > latest.weekNumber) latest = week;
    }
    if (latest) return latest;
  }
  let earliest: T | null = null;
  for (const week of weeks) {
    if (!earliest || week.weekNumber < earliest.weekNumber) earliest = week;
  }
  return earliest;
}
