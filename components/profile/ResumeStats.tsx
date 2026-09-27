import type { TrophyCase } from "@/lib/competitive-resume";
import type { RankIQProfileStats } from "@/types/user";

function count(value: number | null | undefined) {
  return value == null ? "—" : String(value);
}

export function ResumeStats({
  stats,
  counts,
  contestsPlayed,
}: {
  stats: RankIQProfileStats | null;
  counts: TrophyCase["counts"];
  contestsPlayed: number;
}) {
  if (contestsPlayed === 0) return null;

  const items: Array<{ label: string; value: string; hint: string }> = [
    {
      label: "Exact Rank Hits",
      value: count(stats?.exactRankingHits),
      hint: "Player finished exactly where ranked",
    },
    {
      label: "Podium Calls",
      value: count(stats?.podiumHits),
      hint: "Ranked 1–3 and finished Top 3",
    },
    {
      label: "#1 Calls",
      value: count(stats?.numberOneCalls),
      hint: "Ranked #1 and finished #1",
    },
    {
      label: "Weekly Overall Wins",
      value: String(counts.weeklyOverallWins),
      hint: "#1 on the weekly overall board",
    },
    {
      label: "Position Weekly Wins",
      value: String(counts.weeklyPositionWins),
      hint: "#1 on a weekly position board",
    },
    {
      label: "Top 10% Finishes",
      value: String(counts.topTenFinishes),
      hint: "Weekly overall + position boards",
    },
    {
      label: "Weeks Played",
      value: `${counts.weeksPlayed} / ${counts.weeksEligible}`,
      hint: "Of final graded weeks",
    },
    {
      label: "Contests Graded",
      value: String(contestsPlayed),
      hint: "Position boards scored",
    },
  ];

  return (
    <section aria-labelledby="resume-stats-heading" className="mt-8">
      <h2
        id="resume-stats-heading"
        className="font-display text-lg font-semibold text-ink"
      >
        Résumé
      </h2>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {items.map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-border bg-surface px-3 py-3"
          >
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
              {item.label}
            </dt>
            <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
              {item.value}
            </dd>
            <dd className="mt-0.5 text-[11px] leading-snug text-muted">{item.hint}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
