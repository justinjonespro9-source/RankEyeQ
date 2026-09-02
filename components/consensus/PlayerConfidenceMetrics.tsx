import type { PlayerConfidenceSignals } from "@/lib/consensus-math";

const METRIC_COPY = {
  rankPercent: {
    label: "Rank %",
    tooltip:
      "Share of submitted boards that include this player.",
    rankTooltip:
      "Where this player's Rank % stands among this week's position field.",
  },
  podiumPercent: {
    label: "Podium %",
    tooltip:
      "Share of submitted boards placing this player in the Top 3.",
    rankTooltip:
      "Where this player's Podium % stands among this week's position field.",
  },
  averageRank: {
    label: "Avg Rank",
    tooltip:
      "Average placement among boards that include this player.",
    rankTooltip:
      "Where this player's average placement stands among this week's position field.",
  },
} as const;

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatAverage(value: number | null) {
  if (value == null) return "—";
  return value.toFixed(1);
}

function OrdinalRank({
  rank,
  title,
}: {
  rank: number | null;
  title: string;
}) {
  if (rank == null) return null;
  return (
    <span
      className="ml-1.5 text-xs font-medium tabular-nums text-muted"
      title={title}
    >
      #{rank}
    </span>
  );
}

export function ConfidenceMetricCell({
  kind,
  value,
  ordinalRank,
  className = "",
}: {
  kind: keyof typeof METRIC_COPY;
  value: number | null;
  ordinalRank: number | null;
  className?: string;
}) {
  const copy = METRIC_COPY[kind];
  const display =
    kind === "averageRank"
      ? formatAverage(value)
      : value == null
        ? "—"
        : formatPercent(value);

  return (
    <td className={`px-3 py-3 tabular-nums text-ink ${className}`}>
      <span title={copy.tooltip} className="font-medium">
        {display}
      </span>
      <OrdinalRank rank={ordinalRank} title={copy.rankTooltip} />
    </td>
  );
}

export function PlayerConfidenceMetrics({
  signals,
  layout = "inline",
}: {
  signals: PlayerConfidenceSignals;
  layout?: "inline" | "stacked";
}) {
  const rows = [
    {
      kind: "rankPercent" as const,
      value: signals.rankPercent,
      ordinalRank: signals.rankPercentRank,
    },
    {
      kind: "podiumPercent" as const,
      value: signals.podiumPercent,
      ordinalRank: signals.podiumPercentRank,
    },
    {
      kind: "averageRank" as const,
      value: signals.averagePredictedRank,
      ordinalRank: signals.averageRankRank,
    },
  ];

  if (layout === "stacked") {
    return (
      <div className="space-y-1 text-sm">
        {rows.map((row) => {
          const copy = METRIC_COPY[row.kind];
          const display =
            row.kind === "averageRank"
              ? formatAverage(row.value)
              : formatPercent(row.value);
          return (
            <div key={row.kind} className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-muted" title={copy.tooltip}>
                {copy.label}
              </span>
              <span className="tabular-nums text-ink">
                <span className="font-medium">{display}</span>
                <OrdinalRank rank={row.ordinalRank} title={copy.rankTooltip} />
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
      {rows.map((row) => {
        const copy = METRIC_COPY[row.kind];
        const display =
          row.kind === "averageRank"
            ? formatAverage(row.value)
            : formatPercent(row.value);
        return (
          <span key={row.kind} title={copy.tooltip}>
            <span className="text-xs text-muted">{copy.label} </span>
            <span className="font-medium text-ink">{display}</span>
            <OrdinalRank rank={row.ordinalRank} title={copy.rankTooltip} />
          </span>
        );
      })}
    </div>
  );
}

export function PlayerConfidenceMetricHeader({
  kind,
}: {
  kind: keyof typeof METRIC_COPY;
}) {
  const copy = METRIC_COPY[kind];
  return (
    <th className="px-3 py-3" title={copy.tooltip}>
      {copy.label}
    </th>
  );
}
