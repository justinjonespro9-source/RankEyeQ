import { LeaderboardMetricsGrid } from "@/components/leaderboards/LeaderboardRowMetrics";
import {
  WAIVER_METRIC_ORDER,
  waiverMetricValue,
  type WaiverLeaderboardRow,
} from "@/lib/waivers/leaderboard-model";

export function WaiverRowMetrics({ row }: { row: WaiverLeaderboardRow }) {
  return (
    <LeaderboardMetricsGrid
      cells={WAIVER_METRIC_ORDER.map((metric) => ({
        key: metric.key,
        label: metric.label,
        title: metric.title,
        value: waiverMetricValue(row, metric.key),
      }))}
    />
  );
}
