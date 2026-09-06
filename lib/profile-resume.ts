import { formatRankIqScore } from "@/lib/scoring";
import type { ProfileContestHistoryItem } from "@/types/profile";
import type { RankIQProfileStats } from "@/types/user";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export type PositionPerformance = {
  position: ContestPosition;
  weeksSubmitted: number;
  averageEyeq: number | null;
  bestEyeq: number | null;
  leaderboardRank: number | null;
};

export type RankEyeQResume = {
  contestsPlayed: number;
  averageEyeq: number | null;
  overallRank: number | null;
  bestWeekLabel: string | null;
  /** Mean EYEQ across contests in the last up-to-4 distinct weeks. */
  recentForm: {
    weekCount: number;
    averageEyeq: number | null;
    label: string;
  } | null;
  positions: PositionPerformance[];
  hasGradedHistory: boolean;
};

const POSITIONS: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];

/**
 * Derive résumé aggregates from graded history + season stats.
 * Does not invent values when history is empty.
 */
export function buildRankEyeQResume(input: {
  stats: RankIQProfileStats;
  history: ProfileContestHistoryItem[];
  contestsPlayed: number;
}): RankEyeQResume {
  const { stats, history, contestsPlayed } = input;
  const hasGradedHistory = contestsPlayed > 0 && history.length > 0;

  const positions: PositionPerformance[] = POSITIONS.map((position) => {
    const rows = history.filter((item) => item.position === position);
    const scores = rows
      .map((row) => row.normalizedScore)
      .filter((value): value is number => value != null);
    const uiKey = position.toLowerCase() as keyof RankIQProfileStats["positionRanks"];
    return {
      position,
      weeksSubmitted: rows.length,
      averageEyeq:
        scores.length === 0
          ? null
          : scores.reduce((sum, value) => sum + value, 0) / scores.length,
      bestEyeq: scores.length === 0 ? null : Math.max(...scores),
      leaderboardRank: stats.positionRanks[uiKey] ?? null,
    };
  });

  return {
    contestsPlayed,
    averageEyeq: stats.averageRankingScore,
    overallRank: stats.overallRank,
    bestWeekLabel: stats.bestWeek,
    recentForm: buildRecentForm(history),
    positions,
    hasGradedHistory,
  };
}

function buildRecentForm(history: ProfileContestHistoryItem[]) {
  if (history.length === 0) return null;

  const byWeek = new Map<number, number[]>();
  for (const item of history) {
    if (item.normalizedScore == null) continue;
    const list = byWeek.get(item.weekNumber) ?? [];
    list.push(item.normalizedScore);
    byWeek.set(item.weekNumber, list);
  }

  const weekNumbers = [...byWeek.keys()].sort((a, b) => b - a).slice(0, 4);
  if (weekNumbers.length === 0) return null;

  const scores = weekNumbers.flatMap((week) => byWeek.get(week) ?? []);
  const averageEyeq =
    scores.reduce((sum, value) => sum + value, 0) / scores.length;

  return {
    weekCount: weekNumbers.length,
    averageEyeq,
    label:
      weekNumbers.length >= 4
        ? "Last 4 Weeks"
        : weekNumbers.length === 1
          ? "Recent form"
          : `Last ${weekNumbers.length} Weeks`,
  };
}

/** Group graded receipts by week number (desc) for expandable UI. */
export function groupReceiptsByWeek(history: ProfileContestHistoryItem[]) {
  const map = new Map<
    number,
    { weekNumber: number; weekLabel: string; items: ProfileContestHistoryItem[] }
  >();

  for (const item of history) {
    const existing = map.get(item.weekNumber);
    if (existing) {
      existing.items.push(item);
    } else {
      map.set(item.weekNumber, {
        weekNumber: item.weekNumber,
        weekLabel: item.weekLabel,
        items: [item],
      });
    }
  }

  return [...map.values()].sort((a, b) => b.weekNumber - a.weekNumber);
}

export function formatEyeqOrDash(value: number | null | undefined) {
  if (value == null) return null;
  return formatRankIqScore(value);
}
