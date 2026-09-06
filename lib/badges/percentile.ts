/**
 * Pure percentile helpers for qualified leaderboard cohorts.
 * Dense ranks: rank 1 is best. Top X% means rank is within the top share of N.
 */
export function maxRankForPercentile(cohortSize: number, percentile: number): number {
  if (cohortSize <= 0 || percentile <= 0) return 0;
  return Math.max(1, Math.ceil(cohortSize * percentile));
}

export function qualifiesForTopPercentile(input: {
  rank: number | null;
  cohortSize: number;
  percentile: number;
}): boolean {
  if (input.rank == null || input.rank < 1) return false;
  if (input.cohortSize <= 0) return false;
  return input.rank <= maxRankForPercentile(input.cohortSize, input.percentile);
}

/** Filter to min contests, then re-assign dense ranks by averageScore desc. */
export function qualifyLeaderboardRows<
  T extends { contestsPlayed: number; averageScore: number; bestScore?: number; displayName?: string },
>(rows: T[], minContests: number): Array<T & { qualifiedRank: number }> {
  const filtered = rows
    .filter((row) => row.contestsPlayed >= minContests)
    .sort((a, b) => {
      if (b.averageScore !== a.averageScore) {
        return b.averageScore - a.averageScore;
      }
      if ((b.bestScore ?? 0) !== (a.bestScore ?? 0)) {
        return (b.bestScore ?? 0) - (a.bestScore ?? 0);
      }
      return (a.displayName ?? "").localeCompare(b.displayName ?? "");
    });

  return filtered.map((row, index) => ({
    ...row,
    qualifiedRank: index + 1,
  }));
}
