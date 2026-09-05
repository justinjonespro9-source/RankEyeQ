import {
  getFantasyScoringReferenceTables,
  getFantasyScoringSummary,
} from "@/lib/fantasy/scoring-reference";
import { DEFAULT_FANTASY_SCORING_VERSION } from "@/lib/fantasy/scoring-config";

/**
 * Shared FantasyTrack scoring rules presentation (also used by RankEyeQ
 * How It Works / ranking Scoring & Rules). Values come from the production
 * fantasy engine for the requested version slug.
 */
export function FantasyTrackScoringRules({
  version = DEFAULT_FANTASY_SCORING_VERSION,
  compact = false,
}: {
  version?: string;
  compact?: boolean;
}) {
  const summary = getFantasyScoringSummary(version);
  const tables = getFantasyScoringReferenceTables(version);

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      <div>
        <p className="text-sm font-medium text-ink">Format: {summary.formatLabel}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">{summary.summary}</p>
        <p className="mt-1 font-mono text-xs text-muted">{summary.version}</p>
      </div>
      <div className={`grid gap-4 ${compact ? "" : "lg:grid-cols-2"}`}>
        <RulesTable title="Offense" rows={tables.offenseRows} />
        <RulesTable title="D/ST" rows={tables.defenseRows} />
      </div>
      <p className="text-xs leading-relaxed text-muted">
        Yardage bonuses are one-time per category and can stack (e.g. 100 rush +
        100 receiving = +10). A punt/kick return TD credits +6 to the returner and
        +6 to team D/ST as separate scoring entities.
      </p>
    </div>
  );
}

function RulesTable({
  title,
  rows,
}: {
  title: string;
  rows: { category: string; value: string }[];
}) {
  return (
    <div>
      <h3 className="font-medium text-ink">{title}</h3>
      <table className="mt-2 w-full text-left text-sm">
        <tbody>
          {rows.map((row) => (
            <tr key={row.category} className="border-b border-border last:border-0">
              <td className="py-2 pr-3 text-muted">{row.category}</td>
              <td className="py-2 font-medium tabular-nums text-ink">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
