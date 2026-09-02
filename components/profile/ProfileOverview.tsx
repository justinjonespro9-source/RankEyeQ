import type { ProfileOverviewData } from "@/lib/profile-modules";
import { EYEQ_SCORE_LABEL } from "@/lib/brand";
import { formatRankIqScore } from "@/lib/scoring";
import type { RankIQProfileStats } from "@/types/user";
import Link from "next/link";

export function ProfileOverview({
  overview,
  stats,
  contestsPlayed,
  isBot,
  isBenchmark,
}: {
  overview: ProfileOverviewData;
  stats: RankIQProfileStats | null;
  contestsPlayed: number;
  isBot: boolean;
  isBenchmark: boolean;
}) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-display text-xl font-semibold text-ink">Overview</h2>
        <p className="mt-1 text-sm text-muted">
          One universal profile across RankEyeQ, Handicap Hero, and FantasyTrack.
          Each product keeps its own stats — there is no combined cross-product score.
        </p>
      </div>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Products
        </h3>
        <ul className="mt-3 grid gap-3 sm:grid-cols-3">
          {overview.products.map((product) => (
            <li
              key={product.key}
              className="rounded-lg border border-border bg-surface px-4 py-4"
            >
              <p className="font-medium text-ink">{product.label}</p>
              <p className="mt-1 text-sm text-muted">
                {product.participated
                  ? (product.summary ?? "Active")
                  : "Not yet active on this profile"}
              </p>
            </li>
          ))}
        </ul>
      </div>

      {stats && contestsPlayed > 0 ? (
        <div className="rounded-lg border border-accent/30 bg-accent-soft/40 px-5 py-5">
          <h3 className="font-display text-lg font-semibold text-ink">
            RankEyeQ summary
          </h3>
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">
                Season rank
              </dt>
              <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
                {stats.overallRank ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">
                Avg {EYEQ_SCORE_LABEL}
              </dt>
              <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
                {stats.averageRankingScore == null
                  ? "—"
                  : formatRankIqScore(stats.averageRankingScore)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">
                Contests
              </dt>
              <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
                {contestsPlayed}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}

      {isBot ? (
        <p className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted">
          This is an AI competitor profile. Rankings are submitted through
          RankEyeQ&apos;s administrative AI workflow — not by an independent human
          account. See{" "}
          <Link href="/legal/ai-disclosure" className="text-accent hover:underline">
            AI disclosure
          </Link>
          .
        </p>
      ) : null}

      {isBenchmark ? (
        <p className="rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-muted">
          Independent expert benchmark source — not a human or AI competitor account.
        </p>
      ) : null}

      {overview.recentRankEyeQ.length > 0 ? (
        <div>
          <h3 className="font-display text-lg font-semibold text-ink">
            Recent RankEyeQ activity
          </h3>
          <ol className="mt-3 divide-y divide-border rounded-lg border border-border">
            {overview.recentRankEyeQ.map((item) => (
              <li
                key={item.href}
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <Link href={item.href} className="text-ink hover:text-accent">
                  {item.weekLabel} · {item.position}
                </Link>
                <span className="font-display font-semibold tabular-nums text-ink">
                  {item.normalizedScore == null
                    ? "—"
                    : formatRankIqScore(item.normalizedScore)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
