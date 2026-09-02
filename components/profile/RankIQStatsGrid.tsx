import type { RankIQProfileStats } from "@/types/user";

function formatRate(value: number | null) {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

function formatValue(value: string | number | null) {
  if (value === null) return "—";
  return String(value);
}

const POSITIONS = [
  { key: "qb" as const, label: "QB" },
  { key: "rb" as const, label: "RB" },
  { key: "wr" as const, label: "WR" },
  { key: "te" as const, label: "TE" },
  { key: "def" as const, label: "DEF" },
];

export function RankIQStatsGrid({
  stats,
  contestsPlayed,
  rankScopeLabel = "Season leaderboard rank",
}: {
  stats: RankIQProfileStats;
  contestsPlayed?: number;
  rankScopeLabel?: string;
}) {
  const hitCards: { label: string; value: string }[] = [
    { label: "Top-N Hit Rate", value: formatRate(stats.topHitRate) },
    { label: "Exact Hits", value: formatValue(stats.exactRankingHits) },
    { label: "#1 Hits", value: formatValue(stats.numberOneHits) },
    { label: "Podium Hits", value: formatValue(stats.podiumHits) },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-accent/30 bg-accent-soft/40 px-5 py-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">
          Season EYEQ
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">
              {rankScopeLabel}
            </p>
            <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-ink">
              {formatValue(stats.overallRank)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">
              Avg EYEQ Score
            </p>
            <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-ink">
              {stats.averageRankingScore === null
                ? "—"
                : stats.averageRankingScore.toFixed(1)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">
              Contests played
            </p>
            <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-ink">
              {formatValue(contestsPlayed ?? null)}
            </p>
          </div>
        </div>
        {stats.bestWeek ? (
          <p className="mt-4 text-sm text-muted">
            Best performance:{" "}
            <span className="font-medium text-ink">{stats.bestWeek}</span>
          </p>
        ) : null}
      </div>

      <div>
        <h3 className="font-display text-lg font-semibold text-ink">
          By position
        </h3>
        <p className="mt-1 text-sm text-muted">
          Season leaderboard rank per position — each point comes from a graded
          weekly contest.
        </p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-5">
          {POSITIONS.map((position) => (
            <div
              key={position.key}
              className="rounded-lg border border-border bg-surface px-3 py-3 text-center"
            >
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                {position.label}
              </dt>
              <dd className="mt-2 font-display text-2xl font-semibold tabular-nums text-ink">
                {formatValue(stats.positionRanks[position.key])}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <h3 className="font-display text-lg font-semibold text-ink">
          Hit metrics
        </h3>
        <p className="mt-1 text-sm text-muted">
          Podium Hits are Top 3 picks that finished actual Top 3. Exact Hits
          track numerical matches even when precision points were suppressed by a
          Podium Call.
        </p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {hitCards.map((card) => (
            <div
              key={card.label}
              className="rounded-lg border border-border bg-surface px-4 py-4"
            >
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                {card.label}
              </dt>
              <dd className="mt-2 font-display text-2xl font-semibold tabular-nums text-ink">
                {card.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
