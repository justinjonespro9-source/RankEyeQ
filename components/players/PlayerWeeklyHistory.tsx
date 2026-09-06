import Link from "next/link";
import {
  finishTierLabel,
  formatSelectionPct,
  highestSelectedGroup,
} from "@/lib/player-profile";
import type { PlayerWeeklyProfileRow } from "@/lib/player-profile";

export function PlayerWeeklyHistoryTable({
  weeks,
  seasonId,
}: {
  weeks: PlayerWeeklyProfileRow[];
  seasonId?: string;
}) {
  if (weeks.length === 0) {
    return (
      <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-5 text-sm text-muted">
        Season performance will populate after Week 1 results are graded.
      </p>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface-elevated">
      <table className="w-full min-w-[48rem] text-left text-sm">
        <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-3 py-3">Week</th>
            <th className="px-3 py-3">Opp</th>
            <th className="px-3 py-3">Team</th>
            <th className="px-3 py-3">FP</th>
            <th className="px-3 py-3">Finish</th>
            <th className="px-3 py-3">Tier</th>
            <th className="px-3 py-3">Public</th>
            <th className="px-3 py-3">Experts</th>
            <th className="px-3 py-3">Creators</th>
            <th className="px-3 py-3">AI</th>
            <th className="px-3 py-3">Overall</th>
            <th className="px-3 py-3">Mkt rank</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((row) => {
            const rates = row.market?.selectionRates;
            const consensusHref = `/consensus?position=${row.position.toLowerCase()}&week=${row.weekNumber}`;
            return (
              <tr
                key={`${row.contestId}-${row.weekNumber}`}
                className="border-b border-border last:border-0 align-top"
              >
                <td className="px-3 py-3 text-ink">
                  <Link
                    href={consensusHref}
                    className="font-medium text-accent hover:underline"
                  >
                    {row.weekLabel}
                  </Link>
                </td>
                <td className="px-3 py-3 text-muted">{row.opponent ?? "—"}</td>
                <td className="px-3 py-3 text-ink">{row.team}</td>
                <td className="px-3 py-3 tabular-nums text-ink">
                  {row.fantasyPoints == null ? "—" : row.fantasyPoints.toFixed(1)}
                </td>
                <td className="px-3 py-3 tabular-nums text-ink">
                  {row.actualRank ?? "—"}
                </td>
                <td className="px-3 py-3 text-ink">
                  {finishTierLabel(row.actualRank) ?? "—"}
                </td>
                {row.marketPrivate ? (
                  <td colSpan={5} className="px-3 py-3 text-xs text-muted">
                    Market private until Sunday lock / reveal
                  </td>
                ) : (
                  <>
                    <td className="px-3 py-3 tabular-nums text-ink">
                      {formatSelectionPct(rates?.human)}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-ink">
                      {formatSelectionPct(rates?.expert)}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-muted">
                      {formatSelectionPct(rates?.creator)}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-ink">
                      {formatSelectionPct(rates?.ai)}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-ink">
                      {formatSelectionPct(rates?.all)}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-ink">
                      {row.market?.consensusRanks.all ?? "—"}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {seasonId ? (
        <p className="border-t border-border px-3 py-2 text-xs text-muted">
          Selection % comes from immutable pregame snapshots at Sunday lock.
          Creator % appears as — until Creator columns are stored on snapshots.
        </p>
      ) : null}
    </div>
  );
}

export function WhoSawItComing({ weeks }: { weeks: PlayerWeeklyProfileRow[] }) {
  const stories = weeks
    .filter((row) => row.graded && row.market && !row.marketPrivate)
    .slice(0, 8);

  if (stories.length === 0) {
    return (
      <p className="mt-4 text-sm text-muted">
        “Who saw it coming” comparisons appear once graded weeks have frozen
        pregame market snapshots.
      </p>
    );
  }

  return (
    <ul className="mt-4 space-y-3">
      {stories.map((row) => {
        const rates = row.market!.selectionRates;
        const highest = highestSelectedGroup(rates);
        const trend =
          row.actualRank != null && row.market?.consensusRanks.all != null
            ? row.actualRank - row.market.consensusRanks.all
            : null;

        return (
          <li
            key={`saw-${row.contestId}`}
            className="rounded-lg border border-border bg-surface px-4 py-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium text-ink">
                {row.weekLabel}
                {row.actualRank != null ? (
                  <span className="text-muted">
                    {" "}
                    · Actual {row.position}
                    {row.actualRank}
                  </span>
                ) : null}
              </p>
              {highest ? (
                <p className="text-xs font-semibold uppercase tracking-wide text-accent">
                  Highest selected: {highest.label} (
                  {formatSelectionPct(highest.rate)})
                </p>
              ) : null}
            </div>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5 text-sm">
              <MarketStat label="Public" value={formatSelectionPct(rates.human)} />
              <MarketStat
                label="Experts"
                value={formatSelectionPct(rates.expert)}
              />
              <MarketStat
                label="Creators"
                value={formatSelectionPct(rates.creator)}
              />
              <MarketStat label="AI" value={formatSelectionPct(rates.ai)} />
              <MarketStat
                label="Overall"
                value={formatSelectionPct(rates.all)}
              />
            </dl>
            {trend != null ? (
              <p className="mt-2 text-xs text-muted">
                {trend === 0
                  ? "Finished exactly on overall market rank."
                  : trend < 0
                    ? `Outperformed overall market by ${Math.abs(trend)} ranks.`
                    : `Finished ${trend} ranks worse than overall market.`}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function MarketStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 font-display font-semibold tabular-nums text-ink">
        {value}
      </dd>
    </div>
  );
}
