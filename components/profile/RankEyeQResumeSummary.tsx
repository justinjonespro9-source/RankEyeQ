import { EYEQ_SCORE_LABEL } from "@/lib/brand";
import type { RankEyeQResume } from "@/lib/profile-resume";
import { formatRankIqScore } from "@/lib/scoring";

function dash(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

/**
 * RankEyeQ résumé summary — season + recent form + position grid.
 * Shows intentional empty copy before Week 1 grades exist (no fake 0.0s).
 */
export function RankEyeQResumeSummary({
  resume,
  rankScopeLabel = "Season leaderboard rank",
  currentWeekSubmitted = false,
}: {
  resume: RankEyeQResume;
  rankScopeLabel?: string;
  /** True when current-week boards exist but may still be private/ungraded. */
  currentWeekSubmitted?: boolean;
}) {
  if (!resume.hasGradedHistory) {
    return (
      <div className="rounded-lg border border-border bg-surface px-5 py-6">
        <h3 className="font-display text-lg font-semibold text-ink">
          Season résumé
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {currentWeekSubmitted
            ? "Week rankings submitted. Receipts unlock after results are graded."
            : "Season performance begins after Week 1."}
        </p>
        <p className="mt-3 text-xs text-muted">
          Overall {EYEQ_SCORE_LABEL}, position ranks, and Weekly Receipts appear
          once contests are graded.
        </p>
      </div>
    );
  }

  const positionsWithData = resume.positions.filter(
    (row) => row.weeksSubmitted > 0,
  );

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-accent/30 bg-accent-soft/40 px-5 py-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">
          Season résumé
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label={rankScopeLabel}
            value={dash(resume.overallRank)}
          />
          <Stat
            label={`Avg ${EYEQ_SCORE_LABEL}`}
            value={
              resume.averageEyeq == null
                ? "—"
                : formatRankIqScore(resume.averageEyeq)
            }
          />
          <Stat label="Weeks / contests" value={dash(resume.contestsPlayed)} />
          <Stat
            label={resume.recentForm?.label ?? "Recent form"}
            value={
              resume.recentForm?.averageEyeq == null
                ? "—"
                : formatRankIqScore(resume.recentForm.averageEyeq)
            }
          />
        </div>
        {resume.bestWeekLabel ? (
          <p className="mt-4 text-sm text-muted">
            Best performance:{" "}
            <span className="font-medium text-ink">{resume.bestWeekLabel}</span>
          </p>
        ) : null}
      </div>

      <div>
        <h3 className="font-display text-lg font-semibold text-ink">
          By position
        </h3>
        <p className="mt-1 text-sm text-muted">
          Average {EYEQ_SCORE_LABEL}, season rank, and weeks submitted — only
          positions with graded boards are highlighted.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {resume.positions.map((row) => {
            const active = row.weeksSubmitted > 0;
            return (
              <div
                key={row.position}
                className={`rounded-lg border px-3 py-3 ${
                  active
                    ? "border-border bg-surface"
                    : "border-border/60 bg-surface/50 opacity-70"
                }`}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {row.position}
                </p>
                {active ? (
                  <dl className="mt-2 space-y-1.5 text-sm">
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted">Avg</dt>
                      <dd className="font-display font-semibold tabular-nums text-ink">
                        {row.averageEyeq == null
                          ? "—"
                          : formatRankIqScore(row.averageEyeq)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted">Rank</dt>
                      <dd className="tabular-nums text-ink">
                        {dash(row.leaderboardRank)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted">Weeks</dt>
                      <dd className="tabular-nums text-ink">
                        {row.weeksSubmitted}
                      </dd>
                    </div>
                    {row.bestEyeq != null ? (
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted">Best</dt>
                        <dd className="tabular-nums text-ink">
                          {formatRankIqScore(row.bestEyeq)}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                ) : (
                  <p className="mt-2 text-xs text-muted">No graded weeks yet</p>
                )}
              </div>
            );
          })}
        </div>
        {positionsWithData.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            Position splits appear after the first graded contest.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}
