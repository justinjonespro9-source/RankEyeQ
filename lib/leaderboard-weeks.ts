type WeekLike = { id: string; weekNumber: number; status: string };

const LEADERBOARD_WEEK_STATUSES = new Set([
  "OPEN",
  "LOCKED",
  "COMPLETE",
  "ARCHIVED",
]);

/** Weeks offered as Weekly leaderboard tabs (started weeks only), ascending. */
export function leaderboardWeekOptions<T extends WeekLike>(
  weeks: readonly T[],
): T[] {
  return weeks
    .filter((week) => LEADERBOARD_WEEK_STATUSES.has(week.status))
    .sort((a, b) => a.weekNumber - b.weekNumber);
}

export function parseLeaderboardWeekParam(
  raw: string | undefined,
): number | null {
  if (!raw || !/^\d{1,2}$/.test(raw)) return null;
  const value = Number(raw);
  return value >= 1 ? value : null;
}

/**
 * Requested week if offered; otherwise the latest graded week; otherwise the
 * current week; otherwise the latest offered week.
 */
export function resolveLeaderboardWeek<T extends WeekLike>(input: {
  options: readonly T[];
  requestedWeekNumber: number | null;
  latestGradedWeekId: string | null;
  currentWeekId: string | null;
}): T | null {
  const { options } = input;
  return (
    options.find((week) => week.weekNumber === input.requestedWeekNumber) ??
    options.find((week) => week.id === input.latestGradedWeekId) ??
    options.find((week) => week.id === input.currentWeekId) ??
    options.at(-1) ??
    null
  );
}
