import { BrandWordmark } from "@/components/brand/BrandWordmark";
import {
  HERO_DEMO_CONSENSUS_ROWS,
  HERO_DEMO_FILTERS,
} from "@/components/home/hero-demo-data";

/**
 * Visual-only desktop Consensus screen — mirrors /consensus chrome + table
 * (All / Humans / Experts / Creators / AI, Selected %, Avg sel rank).
 */
export function HeroLaptopConsensusScreen() {
  return (
    <div className="flex h-full flex-col bg-background text-[10px] leading-tight">
      <header className="flex items-center justify-between gap-2 border-b border-border bg-off-white px-3 py-2">
        <div className="flex items-center gap-2">
          <BrandWordmark size="sm" variant="light" className="scale-90 origin-left" />
          <span className="hidden text-[10px] font-medium text-muted sm:inline">
            Consensus
          </span>
        </div>
        <span className="rounded border border-border bg-surface px-1.5 py-0.5 text-[9px] font-medium text-muted">
          Week · RB
        </span>
      </header>

      <div className="space-y-2 border-b border-border bg-surface px-3 py-2">
        <p className="font-display text-[13px] font-semibold text-ink">
          Community EYEQ
        </p>
        <div className="flex flex-wrap gap-1">
          {HERO_DEMO_FILTERS.map((label) => {
            const active = label === "All";
            return (
              <span
                key={label}
                className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${
                  active
                    ? "bg-ink text-off-white"
                    : "border border-border bg-surface-elevated text-ink"
                }`}
              >
                {label}
              </span>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1">
          {(["QB", "RB", "WR", "TE", "DEF"] as const).map((pos) => (
            <span
              key={pos}
              className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${
                pos === "RB"
                  ? "bg-accent-soft text-ink"
                  : "border border-border bg-surface-elevated text-ink"
              }`}
            >
              {pos}
            </span>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-2.5 py-2">
        <div className="h-full overflow-hidden rounded-md border border-border bg-surface-elevated">
          <table className="w-full text-left">
            <thead className="border-b border-border bg-surface text-[8px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-2 py-1.5 font-medium">#</th>
                <th className="px-2 py-1.5 font-medium">Player</th>
                <th className="px-2 py-1.5 font-medium">Selected %</th>
                <th className="px-2 py-1.5 font-medium">Avg sel</th>
                <th className="hidden px-2 py-1.5 font-medium sm:table-cell">
                  Team
                </th>
              </tr>
            </thead>
            <tbody>
              {HERO_DEMO_CONSENSUS_ROWS.map((row) => (
                <tr
                  key={row.consensusRank}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-2 py-1.5 font-display text-[11px] font-semibold text-ink">
                    {row.consensusRank}
                  </td>
                  <td className="max-w-[7rem] truncate px-2 py-1.5 text-[10px] font-medium text-ink">
                    {row.name}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums text-[10px] text-ink">
                    {(row.selectionRate * 100).toFixed(1)}%
                  </td>
                  <td className="px-2 py-1.5 tabular-nums text-[10px] text-ink">
                    {row.averageSelectedRank.toFixed(1)}
                  </td>
                  <td className="hidden px-2 py-1.5 text-[10px] text-ink sm:table-cell">
                    {row.team}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
