import {
  LEADERBOARD_METRIC_ORDER,
  leaderboardMetricValue,
  type LeaderboardMetricDef,
} from "@/lib/leaderboard-row-metrics";
import type { LeaderboardRow } from "@/lib/leaderboards";

function MetricCell({
  metric,
  value,
  className = "",
}: {
  metric: LeaderboardMetricDef;
  value: string;
  className?: string;
}) {
  const a11y =
    metric.title != null
      ? `${metric.label}: ${value}. ${metric.title}`
      : undefined;

  return (
    <div
      className={`min-w-0 px-1.5 py-1.5 text-center sm:px-2 sm:py-0.5 ${className}`}
      title={metric.title}
    >
      <p className="text-[9px] font-semibold uppercase leading-tight tracking-wide text-muted sm:text-[10px]">
        {metric.label}
      </p>
      <p
        className="mt-0.5 font-display text-[13px] font-semibold leading-none tabular-nums text-ink sm:text-sm"
        aria-label={a11y}
      >
        {value}
      </p>
    </div>
  );
}

export function LeaderboardRowMetrics({
  row,
}: {
  row: Pick<
    LeaderboardRow,
    | "averageScore"
    | "bestScore"
    | "topNHitRate"
    | "exactHits"
    | "numberOneHits"
    | "contestsPlayed"
  >;
}) {
  return (
    <div
      className="grid w-full grid-cols-3 overflow-hidden rounded-md border border-border/80 bg-surface/50 sm:w-auto sm:min-w-[28rem] sm:grid-cols-6 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent"
      role="group"
      aria-label="Leaderboard metrics"
    >
      {LEADERBOARD_METRIC_ORDER.map((metric, index) => {
        const isLastColMobile = (index + 1) % 3 === 0;
        const isLastColDesktop = index === LEADERBOARD_METRIC_ORDER.length - 1;
        const isFirstRowMobile = index < 3;
        return (
          <MetricCell
            key={metric.key}
            metric={metric}
            value={leaderboardMetricValue(row, metric.key)}
            className={[
              !isLastColMobile ? "border-r border-border/70" : "",
              isFirstRowMobile ? "border-b border-border/70 sm:border-b-0" : "",
              !isLastColDesktop ? "sm:border-r sm:border-border/60" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          />
        );
      })}
    </div>
  );
}
