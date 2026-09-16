import { formatRankIqScore } from "@/lib/scoring";
import type { LeaderboardRow } from "@/lib/leaderboards";

export const LEADERBOARD_WINNERS_HINT =
  "Actual No. 1 finishers included anywhere on the ballot.";

export type LeaderboardMetricKey =
  | "avg"
  | "topN"
  | "exact"
  | "best"
  | "winners"
  | "played";

export type LeaderboardMetricDef = {
  key: LeaderboardMetricKey;
  label: string;
  /** Optional accessible explanation (e.g. Winners). */
  title?: string;
};

/** Mobile: row1 Avg/Top-N/Exact, row2 Best/Winners/Played. Desktop: same order in one row. */
export const LEADERBOARD_METRIC_ORDER: LeaderboardMetricDef[] = [
  { key: "avg", label: "Avg EYEQ" },
  { key: "topN", label: "Top-N" },
  { key: "exact", label: "Exact" },
  { key: "best", label: "Best" },
  { key: "winners", label: "Winners", title: LEADERBOARD_WINNERS_HINT },
  { key: "played", label: "Played" },
];

export function leaderboardMetricValue(
  row: Pick<
    LeaderboardRow,
    | "averageScore"
    | "bestScore"
    | "topNHitRate"
    | "exactHits"
    | "numberOneHits"
    | "contestsPlayed"
  >,
  key: LeaderboardMetricKey,
): string {
  switch (key) {
    case "avg":
      return formatRankIqScore(row.averageScore);
    case "best":
      return formatRankIqScore(row.bestScore);
    case "topN":
      return `${Math.round(row.topNHitRate * 100)}%`;
    case "exact":
      return String(row.exactHits);
    case "winners":
      return String(row.numberOneHits);
    case "played":
      return String(row.contestsPlayed);
    default:
      return "—";
  }
}
