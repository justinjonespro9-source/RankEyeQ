import { ScoreSummary } from "@/components/rank/ScoreSummary";
import { ScoredPlayerRow } from "@/components/rank/ScoredPlayerRow";
import { getMockActualFinishes } from "@/lib/mock-results";
import { scoreContest } from "@/lib/scoring";
import type { RankingPlayer } from "@/types/contest";

export function ResultsComparison({
  predicted,
  pool,
  slotCount,
  actualFinishes,
}: {
  predicted: RankingPlayer[];
  pool: RankingPlayer[];
  slotCount: number;
  /** When provided, use stored actual ranks instead of mock finishes. */
  actualFinishes?: Map<string, number> | Record<string, number>;
}) {
  if (predicted.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-surface-elevated p-5">
        <h2 className="font-display text-lg font-semibold text-ink">
          Results comparison
        </h2>
        <p className="mt-2 text-sm text-muted">
          Submit a full weekly ranking board. After the contest is graded against
          that week&apos;s actual fantasy-point finishes, your EYEQ score
          breakdown appears here.
        </p>
      </section>
    );
  }

  const finishes =
    actualFinishes instanceof Map
      ? actualFinishes
      : actualFinishes
        ? new Map(Object.entries(actualFinishes))
        : getMockActualFinishes(pool);

  const summary = scoreContest(
    predicted.map((player, index) => ({
      playerId: player.id,
      playerName: player.name,
      predictedRank: index + 1,
      actualRank: finishes.get(player.id) ?? pool.length + 1,
    })),
    slotCount,
  );

  return (
    <section className="space-y-4">
      <ScoreSummary summary={summary} />

      <div className="rounded-lg border border-border bg-surface-elevated">
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <h2 className="font-display text-lg font-semibold text-ink">
            Player scoring breakdown
          </h2>
          <p className="mt-1 text-sm text-muted">
            Tap a row for the full point breakdown.
          </p>
        </div>

        <ol>
          {summary.players.map((row) => (
            <ScoredPlayerRow key={row.playerId} row={row} />
          ))}
        </ol>
      </div>
    </section>
  );
}
