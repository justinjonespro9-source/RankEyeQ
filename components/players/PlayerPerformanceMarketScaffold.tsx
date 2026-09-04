/**
 * Placeholder scaffold for ranking-market metrics on Player Performance.
 * Shows clean empty states until ballots / graded results exist — never invents history.
 */
export function PlayerPerformanceMarketScaffold() {
  const upcoming = [
    "Weekly positional finish",
    "Average / median finish",
    "Top 3 / 5 / 10 appearances",
    "#1 finishes",
    "Fantasy PPG",
    "Last 3 Weeks",
    "Human Selected %",
    "Expert Selected %",
    "Creator Selected %",
    "AI Selected %",
    "Average selected rank by group",
    "Consensus movement over time",
  ];

  return (
    <section className="mb-10 rounded-lg border border-border bg-surface-elevated px-5 py-6">
      <h2 className="font-display text-lg font-semibold text-ink">
        Ranking market (coming online)
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
        RankEyeQ will show how Humans, Experts, Creators, and AI ranked each
        player before kickoff — alongside actual production. Metrics appear here
        only when real ballots and results exist for the selected season.
      </p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {upcoming.map((label) => (
          <li
            key={label}
            className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted"
          >
            <span className="block font-medium text-ink/80">{label}</span>
            <span className="text-xs">No ranking-market history yet</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
