import { EYEQ_SCORE_LABEL } from "@/lib/brand";
import { formatRankIqScore } from "@/lib/scoring";
import type { ContestScoreSummary } from "@/types/scoring";

export function ScoreSummary({ summary }: { summary: ContestScoreSummary }) {
  return (
    <div className="rounded-lg border border-accent/25 bg-accent-soft/40 p-4 sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
        Contest grade
      </p>
      <p className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        {EYEQ_SCORE_LABEL}: {formatRankIqScore(summary.rankIqScore)} / 100
      </p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Raw Points" value={String(summary.rawPoints)} />
        <Stat label="Theoretical Max" value={String(summary.maxPoints)} />
        <Stat
          label={summary.fieldSize === 15 ? "Top 15 Hits" : "Top 10 Hits"}
          value={`${summary.topNHits} / ${summary.fieldSize}`}
        />
        <Stat
          label="Podium Hits"
          value={`${summary.podiumHits} / 3`}
        />
        <Stat label="Exact Hits" value={String(summary.exactHits)} />
        <Stat
          label="Within 2"
          value={`${summary.withinTwoHits} / ${summary.fieldSize}`}
        />
        <Stat label="#1 Hit" value={summary.numberOneHit ? "Yes" : "No"} />
        <Stat
          label="Avg Rank Error (hits)"
          value={
            summary.averageRankError === null
              ? "—"
              : summary.averageRankError.toFixed(2)
          }
        />
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/80 bg-surface-elevated px-3 py-2.5">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </dt>
      <dd className="mt-1 font-display text-lg font-semibold tabular-nums text-ink">
        {value}
      </dd>
    </div>
  );
}
