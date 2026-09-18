/**
 * Intro copy for Player Performance — NFL player finishes + ranker behavior.
 * Replaces the old “Ranking market coming online” placeholder.
 */
export function PlayerPerformanceIntro() {
  return (
    <section className="mb-8 max-w-3xl">
      <p className="text-sm leading-relaxed text-muted">
        This page evaluates{" "}
        <span className="font-medium text-ink">NFL player performance</span> and
        how official RankEyeQ rankers placed them before kickoff — not competitor
        standings on the RankEyeQ leaderboard.
      </p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border bg-surface-elevated px-3 py-2.5">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Ranked % — All Official Rankers
          </dt>
          <dd className="mt-1 text-sm text-ink">
            Share of eligible official boards (Human, Creator, Expert,
            Publisher, AI) that placed the player on a scoring board. Each board
            counts once — this is not the group-weighted Consensus All.
          </dd>
        </div>
        <div className="rounded-md border border-border bg-surface-elevated px-3 py-2.5">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Avg Rank
          </dt>
          <dd className="mt-1 text-sm text-ink">
            Average scoring position when ranked (reserves excluded).
          </dd>
        </div>
      </dl>
    </section>
  );
}
