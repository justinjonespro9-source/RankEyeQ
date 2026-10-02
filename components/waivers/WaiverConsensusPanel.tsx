import type { WaiverPlayConsensus } from "@/lib/waivers/play-queries";
import { WAIVER_RESULT_FIELD_SIZE, type WaiverPosition } from "@/lib/waivers/constants";
import { formatConsensusPercent } from "@/lib/waivers/consensus-model";

const VISIBLE_ROWS = 10;

/** Post-lock aggregate of submitted boards. Rendered only for locked contests. */
export function WaiverConsensusPanel({
  position,
  consensus,
}: {
  position: WaiverPosition;
  consensus: WaiverPlayConsensus | null;
}) {
  const wide = WAIVER_RESULT_FIELD_SIZE[position] > 3;
  const fieldLabel = `Top ${WAIVER_RESULT_FIELD_SIZE[position]}`;

  return (
    <section aria-labelledby="waiver-consensus-heading" className="mt-8 rounded-lg border border-border bg-surface-elevated p-4 sm:p-5">
      <h3 id="waiver-consensus-heading" className="font-display text-lg font-semibold text-ink">
        {position} Waiver consensus
      </h3>
      {!consensus ? (
        <p className="mt-2 text-sm text-muted">Consensus is being prepared.</p>
      ) : consensus.status === "WITHHELD" ? (
        <p className="mt-2 text-sm text-muted">Consensus will appear as more boards come in.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">
            Based on {consensus.callingBoardCount} submitted boards with calls
            {consensus.abstentionCount > 0
              ? ` · ${consensus.abstentionCount} ${consensus.abstentionCount === 1 ? "board" : "boards"} sat this position out`
              : ""}
            . Drafts never count.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[22rem] text-left text-sm">
              <caption className="sr-only">
                Most called {position} players, with the share of boards calling each player WIN and in the top slots
              </caption>
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Player
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Called
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    WIN %
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Top 3 %
                  </th>
                  {wide ? (
                    <th scope="col" className="py-2 pl-2 text-right font-medium">
                      {fieldLabel} %
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {consensus.rows.slice(0, VISIBLE_ROWS).map((row) => (
                  <tr key={row.rankableEntryId} className="border-b border-border/60 last:border-0">
                    <th scope="row" className="py-2 pr-3 font-medium text-ink">
                      {row.displayName}
                      {row.team ? <span className="ml-1 text-xs font-normal text-muted">{row.team}</span> : null}
                    </th>
                    <td className="px-2 py-2 text-right tabular-nums text-muted">{row.calledCount}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatConsensusPercent(row.winCount, consensus.callingBoardCount)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatConsensusPercent(row.top3Count, consensus.callingBoardCount)}
                    </td>
                    {wide ? (
                      <td className="py-2 pl-2 text-right tabular-nums">
                        {formatConsensusPercent(row.calledCount, consensus.callingBoardCount)}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
            {consensus.rows.length > VISIBLE_ROWS ? (
              <p className="mt-2 text-xs text-muted">
                Showing the {VISIBLE_ROWS} most called of {consensus.rows.length} called players.
              </p>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
