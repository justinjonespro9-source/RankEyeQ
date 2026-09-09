import { getBadgeDefinition } from "@/lib/badges/catalog";
import {
  qualifiesForTopPercentile,
  qualifyLeaderboardRows,
} from "@/lib/badges/percentile";
import { COMPETITOR_BADGE_THRESHOLDS } from "@/lib/badges/thresholds";
import type { EarnedBadge } from "@/lib/badges/types";
import type { ContestPosition, ProfileType } from "@/lib/generated/prisma/client";
import { isPublisherConsensusSource } from "@/lib/expert-identity";
import {
  getSeasonLeaderboard,
  type LeaderboardFilter,
  type LeaderboardRow,
} from "@/lib/leaderboards";
import { prisma } from "@/lib/db";
import type { ProfileContestHistoryItem } from "@/types/profile";
import type { RankIQProfileStats } from "@/types/user";
import { PERCENTILE_CUTOFFS } from "@/lib/badges/thresholds";

function classFilterForProfile(
  profileType: ProfileType,
  expertSourceKind?: string | null,
): LeaderboardFilter {
  if (profileType === "BENCHMARK") {
    return isPublisherConsensusSource(expertSourceKind)
      ? "PUBLISHER"
      : "EXPERT";
  }
  if (profileType === "CREATOR") return "CREATOR";
  if (profileType === "AI") return "AI";
  return "ALL";
}

function earn(
  id: string,
  detail: string | null,
  earnedAtLabel: string | null = null,
): EarnedBadge | null {
  const definition = getBadgeDefinition(id);
  if (!definition) return null;
  return { id: definition.id, definition, detail, earnedAtLabel };
}

/**
 * Hot Streak: ≥3 consecutive weekNumbers where mean EYEQ that week ≥ threshold.
 */
export function detectHotStreak(
  history: ProfileContestHistoryItem[],
  options?: {
    minWeeks?: number;
    minEyeq?: number;
  },
): { earned: boolean; detail: string | null } {
  const minWeeks =
    options?.minWeeks ?? COMPETITOR_BADGE_THRESHOLDS.hotStreakMinWeeks;
  const minEyeq =
    options?.minEyeq ?? COMPETITOR_BADGE_THRESHOLDS.hotStreakMinEyeq;

  const byWeek = new Map<number, number[]>();
  for (const item of history) {
    if (item.normalizedScore == null) continue;
    const scores = byWeek.get(item.weekNumber) ?? [];
    scores.push(item.normalizedScore);
    byWeek.set(item.weekNumber, scores);
  }

  const weeks = [...byWeek.entries()]
    .map(([weekNumber, scores]) => ({
      weekNumber,
      average: scores.reduce((sum, value) => sum + value, 0) / scores.length,
    }))
    .sort((a, b) => a.weekNumber - b.weekNumber);

  let streak = 0;
  let bestStreak = 0;
  let prevWeek: number | null = null;

  for (const week of weeks) {
    const consecutive =
      prevWeek != null && week.weekNumber === prevWeek + 1;
    if (week.average >= minEyeq && (streak === 0 || consecutive)) {
      streak = consecutive ? streak + 1 : 1;
      bestStreak = Math.max(bestStreak, streak);
    } else if (week.average >= minEyeq) {
      streak = 1;
      bestStreak = Math.max(bestStreak, streak);
    } else {
      streak = 0;
    }
    prevWeek = week.weekNumber;
  }

  if (bestStreak < minWeeks) {
    return { earned: false, detail: null };
  }
  return {
    earned: true,
    detail: `${bestStreak} consecutive weeks averaging ${minEyeq}+ EYEQ`,
  };
}

export function evaluatePercentileBadges(input: {
  profileId: string;
  overallBoard: LeaderboardRow[];
  positionBoards: Partial<Record<ContestPosition, LeaderboardRow[]>>;
}): EarnedBadge[] {
  const earned: EarnedBadge[] = [];
  const overallQualified = qualifyLeaderboardRows(
    input.overallBoard,
    COMPETITOR_BADGE_THRESHOLDS.minOverallContests,
  );
  const overallRow = overallQualified.find(
    (row) => row.universalProfileId === input.profileId,
  );

  const overallCuts: Array<{
    id: string;
    percentile: number;
    label: string;
  }> = [
    { id: "TOP_1_OVERALL", percentile: PERCENTILE_CUTOFFS.top1, label: "Top 1%" },
    { id: "TOP_5_OVERALL", percentile: PERCENTILE_CUTOFFS.top5, label: "Top 5%" },
    { id: "TOP_10_OVERALL", percentile: PERCENTILE_CUTOFFS.top10, label: "Top 10%" },
  ];

  for (const cut of overallCuts) {
    if (
      overallRow &&
      qualifiesForTopPercentile({
        rank: overallRow.qualifiedRank,
        cohortSize: overallQualified.length,
        percentile: cut.percentile,
      })
    ) {
      const badge = earn(
        cut.id,
        `#${overallRow.qualifiedRank} of ${overallQualified.length} qualified · ${cut.label} overall`,
      );
      if (badge) earned.push(badge);
    }
  }

  for (const position of ["QB", "RB", "WR", "TE", "DEF"] as ContestPosition[]) {
    const board = input.positionBoards[position] ?? [];
    const qualified = qualifyLeaderboardRows(
      board,
      COMPETITOR_BADGE_THRESHOLDS.minPositionContests,
    );
    const row = qualified.find(
      (item) => item.universalProfileId === input.profileId,
    );
    const cuts = [
      { id: `TOP_1_${position}`, percentile: PERCENTILE_CUTOFFS.top1 },
      { id: `TOP_5_${position}`, percentile: PERCENTILE_CUTOFFS.top5 },
      { id: `TOP_10_${position}`, percentile: PERCENTILE_CUTOFFS.top10 },
    ];
    for (const cut of cuts) {
      if (
        row &&
        qualifiesForTopPercentile({
          rank: row.qualifiedRank,
          cohortSize: qualified.length,
          percentile: cut.percentile,
        })
      ) {
        const badge = earn(
          cut.id,
          `#${row.qualifiedRank} of ${qualified.length} qualified · ${position}`,
        );
        if (badge) earned.push(badge);
      }
    }
  }

  return earned;
}

export function evaluateCompetitorHitAndStreakBadges(input: {
  stats: RankIQProfileStats;
  history: ProfileContestHistoryItem[];
}): EarnedBadge[] {
  const earned: EarnedBadge[] = [];

  if (
    (input.stats.exactRankingHits ?? 0) >=
    COMPETITOR_BADGE_THRESHOLDS.minExactHits
  ) {
    const badge = earn(
      "EXACT_HIT",
      `${input.stats.exactRankingHits} exact hit${
        input.stats.exactRankingHits === 1 ? "" : "s"
      }`,
    );
    if (badge) earned.push(badge);
  }

  if (
    (input.stats.podiumHits ?? 0) >= COMPETITOR_BADGE_THRESHOLDS.minPodiumCalls
  ) {
    const badge = earn(
      "PODIUM_CALL",
      `${input.stats.podiumHits} podium call${
        input.stats.podiumHits === 1 ? "" : "s"
      }`,
    );
    if (badge) earned.push(badge);
  }

  const streak = detectHotStreak(input.history);
  if (streak.earned) {
    const badge = earn("HOT_STREAK", streak.detail);
    if (badge) earned.push(badge);
  }

  return earned;
}

/**
 * Pure evaluation given preloaded boards — preferred for tests.
 */
export function evaluateCompetitorBadges(input: {
  profileId: string;
  stats: RankIQProfileStats;
  history: ProfileContestHistoryItem[];
  overallBoard: LeaderboardRow[];
  positionBoards: Partial<Record<ContestPosition, LeaderboardRow[]>>;
}): EarnedBadge[] {
  const percentile = evaluatePercentileBadges({
    profileId: input.profileId,
    overallBoard: input.overallBoard,
    positionBoards: input.positionBoards,
  });
  const hits = evaluateCompetitorHitAndStreakBadges({
    stats: input.stats,
    history: input.history,
  });

  // Prefer tighter overall percentiles first, then position, then hits/streak.
  const order = new Map(
    [
      ...percentile.map((badge) => badge.id),
      ...hits.map((badge) => badge.id),
    ].map((id, index) => [id, index]),
  );

  return [...percentile, ...hits].sort(
    (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
  );
}

export async function getCompetitorBadgesForProfile(input: {
  profileId: string;
  profileType: ProfileType;
  expertSourceKind?: string | null;
  stats: RankIQProfileStats;
  history: ProfileContestHistoryItem[];
  includeTest?: boolean;
}): Promise<EarnedBadge[]> {
  const activeSeason = await prisma.season.findFirst({
    where: { active: true },
  });
  if (!activeSeason) {
    return evaluateCompetitorHitAndStreakBadges({
      stats: input.stats,
      history: input.history,
    });
  }

  const filter = classFilterForProfile(
    input.profileType,
    input.expertSourceKind,
  );
  const overallBoard = await getSeasonLeaderboard({
    seasonId: activeSeason.id,
    filter,
    includeTest: input.includeTest,
  });

  const positionBoards: Partial<Record<ContestPosition, LeaderboardRow[]>> = {};
  for (const position of ["QB", "RB", "WR", "TE", "DEF"] as ContestPosition[]) {
    positionBoards[position] = await getSeasonLeaderboard({
      seasonId: activeSeason.id,
      position,
      filter,
      includeTest: input.includeTest,
    });
  }

  return evaluateCompetitorBadges({
    profileId: input.profileId,
    stats: input.stats,
    history: input.history,
    overallBoard,
    positionBoards,
  });
}
