"use client";

import Link from "next/link";
import type {
  PlayerPerformanceSortKey,
  PlayerQualificationFilter,
} from "@/lib/player-performance";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import type { PlayerPerformanceRow } from "@/lib/player-performance";

const STAT_SORTS: {
  key: PlayerPerformanceSortKey;
  label: string;
  defaultDir: "asc" | "desc";
}[] = [
  { key: "averageFinish", label: "Avg Finish", defaultDir: "asc" },
  { key: "medianFinish", label: "Median", defaultDir: "asc" },
  { key: "weeksRecorded", label: "Weeks", defaultDir: "desc" },
  { key: "top3Finishes", label: "Top 3", defaultDir: "desc" },
  { key: "top5Finishes", label: "Top 5", defaultDir: "desc" },
  { key: "top10Finishes", label: "Top 10", defaultDir: "desc" },
  { key: "numberOneFinishes", label: "#1", defaultDir: "desc" },
  { key: "bestFinish", label: "Best", defaultDir: "asc" },
  { key: "worstFinish", label: "Worst", defaultDir: "desc" },
];

const COLUMN_COUNT = 3 + STAT_SORTS.length;

function formatFinish(value: number | null) {
  return value == null ? "—" : value.toFixed(1);
}

function SortHeader({
  label,
  sortKey,
  active,
  sortDirection,
  defaultDir,
  href,
}: {
  label: string;
  sortKey: PlayerPerformanceSortKey;
  active: boolean;
  sortDirection: "asc" | "desc";
  defaultDir: "asc" | "desc";
  href: (next: {
    sort?: PlayerPerformanceSortKey;
    sortDirection?: "asc" | "desc";
  }) => string;
}) {
  const nextDirection =
    active && sortDirection === defaultDir
      ? defaultDir === "asc"
        ? "desc"
        : "asc"
      : defaultDir;

  return (
    <Link
      href={href({ sort: sortKey, sortDirection: nextDirection })}
      className={active ? "font-semibold text-ink" : "hover:text-ink"}
    >
      {label}
      {active ? (sortDirection === "asc" ? " ↑" : " ↓") : ""}
    </Link>
  );
}

export function PlayerPerformanceTable({
  rows,
  position,
  seasonId,
  qualification,
  sort,
  sortDirection,
}: {
  rows: PlayerPerformanceRow[];
  position: ContestPosition | "ALL";
  seasonId: string;
  qualification: PlayerQualificationFilter;
  sort: PlayerPerformanceSortKey;
  sortDirection: "asc" | "desc";
}) {
  function href(next: {
    sort?: PlayerPerformanceSortKey;
    sortDirection?: "asc" | "desc";
  }) {
    const params = new URLSearchParams({
      seasonId,
      position,
      qualification,
      sort: next.sort ?? sort,
      sortDirection: next.sortDirection ?? sortDirection,
    });
    return `/players?${params.toString()}`;
  }

  return (
    <>
      <div className="space-y-3 md:hidden">
        {rows.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface-elevated px-3 py-8 text-center text-sm text-muted">
            No qualified player results yet for this filter.
          </p>
        ) : (
          rows.map((row) => (
            <article
              key={row.rankableEntryId}
              className="rounded-lg border border-border bg-surface-elevated p-3.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/players/${encodeURIComponent(row.externalId?.trim() || row.rankableEntryId)}?seasonId=${seasonId}`}
                    className="font-medium text-ink hover:text-accent-ink hover:underline"
                  >
                    {row.name}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted">
                    {row.team} · {row.position}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Avg finish
                  </p>
                  <p className="font-display text-lg font-semibold tabular-nums text-ink">
                    {formatFinish(row.averageFinish)}
                  </p>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
                <div className="rounded-md bg-surface px-1.5 py-2">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Weeks
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                    {row.weeksRecorded}
                  </dd>
                </div>
                <div className="rounded-md bg-surface px-1.5 py-2">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Top 10
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                    {row.top10Finishes}
                  </dd>
                </div>
                <div className="rounded-md bg-surface px-1.5 py-2">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    #1
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                    {row.numberOneFinishes}
                  </dd>
                </div>
                <div className="rounded-md bg-surface px-1.5 py-2">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Best
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                    {row.bestFinish ?? "—"}
                  </dd>
                </div>
              </dl>
            </article>
          ))
        )}
      </div>

      <div className="table-scroll hidden overflow-x-auto rounded-lg border border-border bg-surface-elevated md:block">
        <table className="w-full min-w-[64rem] text-left text-sm">
          <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-3">
                <SortHeader
                  label="Player"
                  sortKey="name"
                  active={sort === "name"}
                  sortDirection={sortDirection}
                  defaultDir="asc"
                  href={href}
                />
              </th>
              <th className="px-3 py-3">Team</th>
              <th className="px-3 py-3">Pos</th>
              {STAT_SORTS.map((column) => (
                <th key={column.key} className="px-3 py-3">
                  <SortHeader
                    label={column.label}
                    sortKey={column.key}
                    active={sort === column.key}
                    sortDirection={sortDirection}
                    defaultDir={column.defaultDir}
                    href={href}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMN_COUNT} className="px-3 py-8 text-center text-muted">
                  No qualified player results yet for this filter.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.rankableEntryId} className="border-b border-border last:border-0">
                  <td className="px-3 py-3 font-medium text-ink">
                    <Link
                      href={`/players/${encodeURIComponent(row.externalId?.trim() || row.rankableEntryId)}?seasonId=${seasonId}`}
                      className="hover:text-accent-ink hover:underline"
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-ink">{row.team}</td>
                  <td className="px-3 py-3 text-ink">{row.position}</td>
                  <td className="px-3 py-3 tabular-nums text-ink">
                    {formatFinish(row.averageFinish)}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-ink">
                    {formatFinish(row.medianFinish)}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-ink">
                    {row.weeksRecorded}
                    <span className="text-muted"> / {row.weeksEligible}</span>
                  </td>
                  <td className="px-3 py-3 tabular-nums text-ink">{row.top3Finishes}</td>
                  <td className="px-3 py-3 tabular-nums text-ink">{row.top5Finishes}</td>
                  <td className="px-3 py-3 tabular-nums text-ink">{row.top10Finishes}</td>
                  <td className="px-3 py-3 tabular-nums text-ink">{row.numberOneFinishes}</td>
                  <td className="px-3 py-3 tabular-nums text-ink">
                    {row.bestFinish ?? "—"}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-ink">
                    {row.worstFinish ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
