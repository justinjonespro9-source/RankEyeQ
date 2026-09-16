"use client";

import { useMemo, useState } from "react";
import { ConsensusDeltaMove } from "@/components/results/ConsensusDeltaMove";
import {
  nextResultsSort,
  sortResultsTableRows,
  type ResultsSortDir,
  type ResultsSortKey,
  type ResultsTableRow,
} from "@/lib/results-consensus-display";

function SortHeader({
  label,
  sortKey,
  activeKey,
  activeDir,
  onSort,
  title,
  className = "",
}: {
  label: string;
  sortKey: ResultsSortKey;
  activeKey: ResultsSortKey;
  activeDir: ResultsSortDir;
  onSort: (key: ResultsSortKey) => void;
  title?: string;
  className?: string;
}) {
  const active = activeKey === sortKey;
  const arrow = !active ? "↕" : activeDir === "asc" ? "↑" : "↓";
  return (
    <th
      className={`px-3 py-3 ${className}`}
      title={title}
      aria-sort={
        active ? (activeDir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 font-semibold uppercase tracking-wide transition-colors ${
          active ? "text-ink" : "text-muted hover:text-ink"
        }`}
      >
        {label}
        <span className="text-[10px] tabular-nums opacity-70" aria-hidden="true">
          {arrow}
        </span>
      </button>
    </th>
  );
}

export function ResultsVsConsensusTable({
  rows,
}: {
  rows: ResultsTableRow[];
}) {
  const [sortKey, setSortKey] = useState<ResultsSortKey>("actual");
  const [sortDir, setSortDir] = useState<ResultsSortDir>("asc");

  const sorted = useMemo(
    () => sortResultsTableRows(rows, sortKey, sortDir),
    [rows, sortKey, sortDir],
  );

  function onSort(key: ResultsSortKey) {
    const next = nextResultsSort(sortKey, sortDir, key);
    setSortKey(next.key);
    setSortDir(next.dir);
  }

  if (rows.length === 0) return null;

  return (
    <>
      <div className="space-y-3 md:hidden">
        {sorted.map((entry) => (
          <article
            key={entry.rankableEntryId}
            className="rounded-lg border border-border bg-surface-elevated p-3.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-ink">
                  <span className="font-display font-semibold text-accent-ink">
                    #{entry.actualRank}
                  </span>{" "}
                  {entry.name}
                </p>
                <p className="mt-0.5 text-sm text-muted">
                  {entry.team} · {entry.opponent}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Fantasy Pts
                </p>
                <p className="font-display text-lg font-semibold tabular-nums text-ink">
                  {entry.fantasyPoints.toFixed(1)}
                </p>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
              <div className="rounded-md bg-surface px-2 py-2">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Consensus
                </dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                  {entry.consensusRank ?? "—"}
                </dd>
              </div>
              <div className="rounded-md bg-surface px-2 py-2">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Vs Con.
                </dt>
                <dd className="mt-0.5 flex justify-center text-sm font-semibold">
                  <ConsensusDeltaMove value={entry.consensusVsActual} compact />
                </dd>
              </div>
              <div className="rounded-md bg-surface px-2 py-2">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Selected
                </dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                  {entry.selectionRate == null
                    ? "—"
                    : `${(entry.selectionRate * 100).toFixed(1)}%`}
                </dd>
              </div>
              <div className="rounded-md bg-surface px-2 py-2">
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Ballots
                </dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                  {entry.ballots ?? "—"}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>

      <div className="table-scroll hidden overflow-x-auto rounded-lg border border-border bg-surface-elevated md:block">
        <table className="w-full min-w-[64rem] text-left text-sm">
          <thead className="border-b border-border bg-surface text-xs">
            <tr>
              <SortHeader
                label="Actual"
                sortKey="actual"
                activeKey={sortKey}
                activeDir={sortDir}
                onSort={onSort}
                title="League finish (default ascending)"
              />
              <SortHeader
                label="Player"
                sortKey="player"
                activeKey={sortKey}
                activeDir={sortDir}
                onSort={onSort}
              />
              <SortHeader
                label="Pts"
                sortKey="pts"
                activeKey={sortKey}
                activeDir={sortDir}
                onSort={onSort}
                title="Fantasy points"
              />
              <SortHeader
                label="Consensus"
                sortKey="consensus"
                activeKey={sortKey}
                activeDir={sortDir}
                onSort={onSort}
                title="Pregame consensus rank"
              />
              <SortHeader
                label="Vs Con."
                sortKey="delta"
                activeKey={sortKey}
                activeDir={sortDir}
                onSort={onSort}
                title="Movement vs consensus (Actual − Consensus). Ascending = better than consensus first."
              />
              <SortHeader
                label="Selected %"
                sortKey="selected"
                activeKey={sortKey}
                activeDir={sortDir}
                onSort={onSort}
              />
              <SortHeader
                label="Avg sel rank"
                sortKey="avgSelected"
                activeKey={sortKey}
                activeDir={sortDir}
                onSort={onSort}
              />
              <SortHeader
                label="Ballots"
                sortKey="ballots"
                activeKey={sortKey}
                activeDir={sortDir}
                onSort={onSort}
                title="Individual rankings that selected this player"
              />
              <th className="px-3 py-3 font-semibold uppercase tracking-wide text-muted">
                Team / Opp
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry) => (
              <tr
                key={entry.rankableEntryId}
                className="border-b border-border last:border-0"
              >
                <td className="px-3 py-3 font-display font-semibold text-ink">
                  {entry.actualRank}
                </td>
                <td className="px-3 py-3 font-medium text-ink">{entry.name}</td>
                <td className="px-3 py-3 tabular-nums text-ink">
                  {entry.fantasyPoints.toFixed(1)}
                </td>
                <td className="px-3 py-3 tabular-nums text-ink">
                  {entry.consensusRank ?? "—"}
                </td>
                <td className="px-3 py-3">
                  <ConsensusDeltaMove value={entry.consensusVsActual} />
                </td>
                <td className="px-3 py-3 tabular-nums text-ink">
                  {entry.selectionRate == null
                    ? "—"
                    : `${(entry.selectionRate * 100).toFixed(1)}%`}
                </td>
                <td className="px-3 py-3 tabular-nums text-ink">
                  {entry.averageSelectedRank?.toFixed(1) ?? "—"}
                </td>
                <td className="px-3 py-3 tabular-nums text-ink">
                  {entry.ballots ?? "—"}
                </td>
                <td className="px-3 py-3 text-muted">
                  {entry.team}{" "}
                  <span className="text-muted/80">· {entry.opponent}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
