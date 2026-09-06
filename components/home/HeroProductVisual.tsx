import type { ReactNode } from "react";

/**
 * Decorative homepage hero product mockup.
 * Static demo content only — not live Week 1 ballots/consensus.
 */
const DEMO_RB_BOARD = [
  { rank: 1, name: "Bijan Robinson", team: "ATL", tag: "Podium" },
  { rank: 2, name: "Jahmyr Gibbs", team: "DET", tag: "Podium" },
  { rank: 3, name: "Saquon Barkley", team: "PHI", tag: "Podium" },
  { rank: 4, name: "Devon Achane", team: "MIA", tag: null },
  { rank: 5, name: "Jonathan Taylor", team: "IND", tag: null },
  { rank: 6, name: "Kyren Williams", team: "LAR", tag: null },
  { rank: 7, name: "Breece Hall", team: "NYJ", tag: null },
  { rank: 8, name: "Josh Jacobs", team: "GB", tag: null },
  { rank: 9, name: "James Cook", team: "BUF", tag: null },
  { rank: 10, name: "Chase Brown", team: "CIN", tag: null },
] as const;

const DEMO_CONSENSUS = [
  { name: "Bijan Robinson", rate: "92%", rank: "1.4" },
  { name: "Jahmyr Gibbs", rate: "88%", rank: "2.1" },
  { name: "Saquon Barkley", rate: "81%", rank: "2.8" },
  { name: "Devon Achane", rate: "74%", rank: "4.6" },
] as const;

const DEMO_LEADERBOARD: Array<{
  rank: number;
  name: string;
  score: string;
  badge?: string;
}> = [
  { rank: 1, name: "gridironmind", score: "91.2" },
  { rank: 2, name: "filmroom", score: "88.7" },
  { rank: 3, name: "GPT", score: "86.4", badge: "AI" },
  { rank: 4, name: "sunday_scientist", score: "84.1" },
];

export function HeroProductVisual() {
  return (
    <div
      aria-hidden
      className="relative mx-auto w-full max-w-[26rem] select-none lg:max-w-none"
    >
      {/* Supporting: Consensus (back-left) — desktop composition only */}
      <div className="pointer-events-none absolute -left-6 top-10 z-0 hidden w-[58%] -rotate-3 scale-[0.92] opacity-90 lg:block">
        <ConsensusCard />
      </div>

      {/* Supporting: Leaderboard (back-right) — desktop composition only */}
      <div className="pointer-events-none absolute -right-4 top-20 z-0 hidden w-[56%] rotate-3 scale-[0.9] opacity-90 lg:block">
        <LeaderboardCard />
      </div>

      {/* Focal: Ranking Builder */}
      <div className="relative z-10 mx-auto w-full max-w-[22rem] sm:max-w-[24rem] lg:mx-auto lg:w-[72%] lg:max-w-none">
        <RankingBoardCard />
      </div>

      <p className="relative z-10 mt-3 text-center text-[10px] font-medium uppercase tracking-[0.16em] text-white/45 sm:mt-4">
        Demo product UI · not live results
      </p>
    </div>
  );
}

function PanelShell({
  stage,
  title,
  children,
  className = "",
}: {
  stage: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-lg border border-white/15 bg-surface-elevated shadow-[0_18px_40px_-18px_rgba(0,0,0,0.55)] ${className}`}
    >
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
            {stage}
          </p>
          <p className="font-display text-sm font-semibold text-ink">{title}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function RankingBoardCard() {
  return (
    <PanelShell stage="Rank" title="RB Top 10 · This Week">
      <ol className="divide-y divide-border bg-surface-elevated">
        {DEMO_RB_BOARD.map((row) => (
          <li
            key={row.rank}
            className={`flex items-center gap-2.5 px-3 py-2 ${
              row.tag ? "bg-accent-soft/30" : ""
            }`}
          >
            <span className="font-display w-5 shrink-0 text-center text-sm font-semibold tabular-nums text-accent">
              {row.rank}
            </span>
            <span
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent"
            >
              {initials(row.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">
                {row.name}
              </span>
              <span className="block text-[11px] text-muted">{row.team}</span>
            </span>
            {row.tag ? (
              <span className="shrink-0 rounded border border-accent/25 bg-accent-soft/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">
                {row.tag}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </PanelShell>
  );
}

function ConsensusCard() {
  return (
    <PanelShell stage="Reveal" title="Consensus · RB">
      <ul className="space-y-0 divide-y divide-border bg-surface-elevated px-0 py-0">
        {DEMO_CONSENSUS.map((row) => (
          <li
            key={row.name}
            className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
          >
            <span className="truncate font-medium text-ink">{row.name}</span>
            <span className="shrink-0 tabular-nums text-muted">
              {row.rate} · avg {row.rank}
            </span>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}

function LeaderboardCard() {
  return (
    <PanelShell stage="Prove" title="Week EYEQ">
      <ol className="divide-y divide-border bg-surface-elevated">
        {DEMO_LEADERBOARD.map((row) => (
          <li
            key={row.rank}
            className="flex items-center gap-2 px-3 py-2 text-xs"
          >
            <span className="font-display w-4 tabular-nums font-semibold text-ink">
              {row.rank}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium text-ink">
              {row.name}
              {row.badge ? (
                <span className="ml-1 rounded bg-surface px-1 py-0.5 text-[9px] font-semibold uppercase text-muted">
                  {row.badge}
                </span>
              ) : null}
            </span>
            <span className="font-display tabular-nums font-semibold text-ink">
              {row.score}
            </span>
          </li>
        ))}
      </ol>
    </PanelShell>
  );
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
