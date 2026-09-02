"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatRankIqScore } from "@/lib/scoring";
import { formatPlayerScoreLines } from "@/components/rank/ScoredPlayerRow";
import {
  evaluateLabScenarios,
  getLabActualRank,
  LAB_ACTUAL_ORDER,
  LAB_FIELD_SIZE,
  scoreLabSubmission,
  type LabPlayerId,
} from "@/lib/scoring-lab-scenarios";

const DEFAULT_MANUAL: LabPlayerId[] = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
];

export function ScoringLab() {
  const results = useMemo(() => evaluateLabScenarios(), []);
  const [expanded, setExpanded] = useState<string | null>("perfect");
  const [manual, setManual] = useState<LabPlayerId[]>(DEFAULT_MANUAL);

  const manualSummary = useMemo(
    () => scoreLabSubmission(manual),
    [manual],
  );

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= manual.length) return;
    setManual((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  }

  function setManualSlot(index: number, playerId: LabPlayerId) {
    setManual((current) => {
      const next = [...current];
      const existingIndex = next.indexOf(playerId);
      if (existingIndex === index) return current;
      if (existingIndex >= 0) {
        // Swap to keep unique Top-10 picks
        next[existingIndex] = next[index];
      }
      next[index] = playerId;
      return next;
    });
  }

  return (
    <div className="space-y-10">
      <section className="rounded-lg border border-dashed border-warning/40 bg-warning-soft/40 p-4">
        <Badge tone="warning">Development only</Badge>
        <p className="mt-2 text-sm text-muted">
          Actual finishes are fixed: Players A–J finish 1–10 in order. Every
          scenario is graded by the real <code className="text-ink">lib/scoring.ts</code>{" "}
          engine. Production UI is untouched.
        </p>
        <ol className="mt-3 flex flex-wrap gap-2 text-xs font-medium text-ink">
          {LAB_ACTUAL_ORDER.slice(0, LAB_FIELD_SIZE).map((id, index) => (
            <li
              key={id}
              className="rounded border border-border bg-surface-elevated px-2 py-1"
            >
              {index + 1}. {id}
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="font-display text-2xl font-semibold text-ink">
          Scenario leaderboard
        </h2>
        <p className="mt-1 text-sm text-muted">
          Sorted by EYEQ Score descending.
        </p>

        <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface-elevated">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-3 font-semibold">#</th>
                <th className="px-3 py-3 font-semibold">Scenario</th>
                <th className="px-3 py-3 font-semibold">EYEQ</th>
                <th className="px-3 py-3 font-semibold">Raw</th>
                <th className="px-3 py-3 font-semibold">Top-10</th>
                <th className="px-3 py-3 font-semibold">Exact</th>
                <th className="px-3 py-3 font-semibold">Podium</th>
                <th className="px-3 py-3 font-semibold">Within 2</th>
                <th className="px-3 py-3 font-semibold">#1</th>
                <th className="px-3 py-3 font-semibold">Avg err</th>
              </tr>
            </thead>
            <tbody>
              {results.map((row, index) => {
                const open = expanded === row.id;
                return (
                  <tr key={row.id} className="border-b border-border align-top last:border-0">
                    <td className="px-3 py-3 font-display font-semibold text-ink">
                      {index + 1}
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        className="text-left"
                        onClick={() =>
                          setExpanded((current) =>
                            current === row.id ? null : row.id,
                          )
                        }
                        aria-expanded={open}
                      >
                        <span className="font-semibold text-ink">
                          {row.letter} — {row.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted">
                          {open ? "Hide breakdown" : "Show breakdown"}
                        </span>
                      </button>
                      {open ? (
                        <div className="mt-3 max-w-xl space-y-2">
                          <p className="text-xs text-muted">{row.description}</p>
                          <p className="text-xs text-muted">
                            Predicted: {row.predicted.join(" → ")}
                          </p>
                          <ol className="divide-y divide-border rounded border border-border bg-surface">
                            {row.summary.players.map((player) => (
                              <li
                                key={`${row.id}-${player.playerId}`}
                                className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                              >
                                <span className="text-ink">
                                  Pred {player.predictedRank}: Player{" "}
                                  {player.playerId}{" "}
                                  <span className="text-muted">
                                    (actual {player.actualRank})
                                  </span>
                                </span>
                                <span className="shrink-0 font-semibold tabular-nums text-ink">
                                  {player.totalPoints} pts
                                </span>
                                <span className="mt-1 block text-muted">
                                  {formatPlayerScoreLines(player).join(" · ")}
                                </span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 font-display font-semibold tabular-nums text-ink">
                      {formatRankIqScore(row.summary.rankIqScore)}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-ink">
                      {row.summary.rawPoints}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-ink">
                      {row.summary.topNHits}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-ink">
                      {row.summary.exactHits}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-ink">
                      {row.summary.podiumHits} / 3
                    </td>
                    <td className="px-3 py-3 tabular-nums text-ink">
                      {row.summary.withinTwoHits}
                    </td>
                    <td className="px-3 py-3 text-ink">
                      {row.summary.numberOneHit ? "Yes" : "No"}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-ink">
                      {row.summary.averageRankError === null
                        ? "—"
                        : row.summary.averageRankError.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="font-display text-2xl font-semibold text-ink">
          Manual Top-10 sandbox
        </h2>
        <p className="mt-1 text-sm text-muted">
          Reorder a mock submission and watch the EYEQ Score recalculate
          instantly.
        </p>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <ol className="space-y-2 rounded-lg border border-border bg-surface-elevated p-3 sm:p-4">
            {manual.map((playerId, index) => (
              <li
                key={`manual-${index}`}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2"
              >
                <span className="font-display w-6 text-sm font-semibold text-accent">
                  {index + 1}
                </span>
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Player at rank {index + 1}</span>
                  <select
                    value={playerId}
                    onChange={(event) =>
                      setManualSlot(
                        index,
                        event.target.value as LabPlayerId,
                      )
                    }
                    className="w-full rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-sm text-ink"
                  >
                    {LAB_ACTUAL_ORDER.map((id) => (
                      <option key={id} value={id}>
                        Player {id} (actual {getLabActualRank(id)})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                  >
                    ▲
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => move(index, 1)}
                    disabled={index === manual.length - 1}
                  >
                    ▼
                  </Button>
                </div>
              </li>
            ))}
          </ol>

          <aside className="h-fit rounded-lg border border-accent/25 bg-accent-soft/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
              Live grade
            </p>
            <p className="mt-2 font-display text-3xl font-semibold text-ink">
              {formatRankIqScore(manualSummary.rankIqScore)}
              <span className="text-lg text-muted"> / 100</span>
            </p>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Raw points</dt>
                <dd className="font-semibold tabular-nums text-ink">
                  {manualSummary.rawPoints}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Top-10 hits</dt>
                <dd className="font-semibold tabular-nums text-ink">
                  {manualSummary.topNHits}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Exact hits</dt>
                <dd className="font-semibold tabular-nums text-ink">
                  {manualSummary.exactHits}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Podium hits</dt>
                <dd className="font-semibold tabular-nums text-ink">
                  {manualSummary.podiumHits} / 3
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Within 2</dt>
                <dd className="font-semibold tabular-nums text-ink">
                  {manualSummary.withinTwoHits}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">#1 hit</dt>
                <dd className="font-semibold text-ink">
                  {manualSummary.numberOneHit ? "Yes" : "No"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Avg rank error</dt>
                <dd className="font-semibold tabular-nums text-ink">
                  {manualSummary.averageRankError === null
                    ? "—"
                    : manualSummary.averageRankError.toFixed(2)}
                </dd>
              </div>
            </dl>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-4 w-full"
              onClick={() => setManual(DEFAULT_MANUAL)}
            >
              Reset to perfect
            </Button>
          </aside>
        </div>
      </section>
    </div>
  );
}
