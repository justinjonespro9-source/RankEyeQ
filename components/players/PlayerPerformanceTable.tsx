"use client";

import Link from "next/link";
import type {
  PlayerPerformanceSortKey,
  PlayerQualificationFilter,
  PlayerPerformanceScope,
  WeekPerformanceRow,
  WeekPerformanceSortKey,
} from "@/lib/player-performance";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import type { PlayerPerformanceRow } from "@/lib/player-performance";
import {
  AVG_RANK_TOOLTIP,
  formatAvgRank,
  formatRankedPct,
  RANKED_PCT_LABEL,
  RANKED_PCT_TOOLTIP,
  topNLabelForPosition,
} from "@/lib/player-performance-ranked";

const SEASON_STAT_SORTS: {
  key: PlayerPerformanceSortKey;
  label: string;
  defaultDir: "asc" | "desc";
  title?: string;
}[] = [
  { key: "averageFinish", label: "Avg Finish", defaultDir: "asc" },
  { key: "top10Finishes", label: "Top N", defaultDir: "desc" },
  {
    key: "rankedPct",
    label: RANKED_PCT_LABEL,
    defaultDir: "desc",
    title: RANKED_PCT_TOOLTIP,
  },
  {
    key: "avgRankedPosition",
    label: "Avg Rank",
    defaultDir: "asc",
    title: AVG_RANK_TOOLTIP,
  },
  { key: "weeksRecorded", label: "Appearances", defaultDir: "desc" },
  { key: "numberOneFinishes", label: "#1", defaultDir: "desc" },
  { key: "bestFinish", label: "Best", defaultDir: "asc" },
];

const WEEK_STAT_SORTS: {
  key: WeekPerformanceSortKey;
  label: string;
  defaultDir: "asc" | "desc";
  group: "actual" | "ranker" | "consensus";
  title?: string;
}[] = [
  { key: "actualRank", label: "Actual Finish", defaultDir: "asc", group: "actual" },
  { key: "fantasyPoints", label: "Fantasy Pts", defaultDir: "desc", group: "actual" },
  {
    key: "rankedPct",
    label: RANKED_PCT_LABEL,
    defaultDir: "desc",
    group: "ranker",
    title: RANKED_PCT_TOOLTIP,
  },
  {
    key: "avgRankedPosition",
    label: "Avg Rank",
    defaultDir: "asc",
    group: "ranker",
    title: AVG_RANK_TOOLTIP,
  },
  {
    key: "consensusRank",
    label: "Consensus Rank",
    defaultDir: "asc",
    group: "consensus",
  },
  {
    key: "consensusSelectedPct",
    label: "Consensus Selected %",
    defaultDir: "desc",
    group: "consensus",
    title: "Pregame any-slot Selected % from the immutable snapshot (includes reserves).",
  },
];

function formatFinish(value: number | null) {
  return value == null ? "—" : value.toFixed(1);
}

function formatPct(value: number | null) {
  return formatRankedPct(value);
}

function SortHeader({
  label,
  sortKey,
  active,
  sortDirection,
  defaultDir,
  href,
  title,
}: {
  label: string;
  sortKey: string;
  active: boolean;
  sortDirection: "asc" | "desc";
  defaultDir: "asc" | "desc";
  href: (next: {
    sort?: string;
    sortDirection?: "asc" | "desc";
  }) => string;
  title?: string;
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
      title={title}
    >
      {label}
      {active ? (sortDirection === "asc" ? " ↑" : " ↓") : ""}
    </Link>
  );
}

export function PlayerPerformanceTable({
  rows,
  weekRows = [],
  scope,
  position,
  seasonId,
  qualification,
  sort,
  sortDirection,
  weekId,
}: {
  rows: PlayerPerformanceRow[];
  weekRows?: WeekPerformanceRow[];
  scope: PlayerPerformanceScope;
  position: ContestPosition | "ALL";
  seasonId: string;
  qualification: PlayerQualificationFilter;
  sort: string;
  sortDirection: "asc" | "desc";
  weekId?: string | null;
}) {
  const topNLabel = topNLabelForPosition(position);

  function href(next: {
    sort?: string;
    sortDirection?: "asc" | "desc";
  }) {
    const params = new URLSearchParams({
      seasonId,
      position,
      scope,
      qualification,
      sort: next.sort ?? sort,
      sortDirection: next.sortDirection ?? sortDirection,
    });
    if (weekId) params.set("weekId", weekId);
    return `/players?${params.toString()}`;
  }

  if (scope === "week") {
    return (
      <WeekTable
        rows={weekRows}
        sort={sort as WeekPerformanceSortKey}
        sortDirection={sortDirection}
        seasonId={seasonId}
        href={href}
      />
    );
  }

  const seasonColumnCount = 3 + SEASON_STAT_SORTS.length;

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
                    {row.position === "WR" ? "Top 15" : "Top 10"}
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                    {row.top10Finishes}
                  </dd>
                </div>
                <div className="rounded-md bg-surface px-1.5 py-2">
                  <dt
                    className="text-[10px] font-semibold uppercase tracking-wide text-muted"
                    title={RANKED_PCT_TOOLTIP}
                  >
                    Ranked %
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                    {formatPct(row.rankedPct)}
                  </dd>
                </div>
                <div className="rounded-md bg-surface px-1.5 py-2">
                  <dt
                    className="text-[10px] font-semibold uppercase tracking-wide text-muted"
                    title={AVG_RANK_TOOLTIP}
                  >
                    Avg Rank
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                    {formatAvgRank(row.avgRankedPosition)}
                  </dd>
                </div>
                <div className="rounded-md bg-surface px-1.5 py-2">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Sample
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                    {row.weeksRecorded}
                  </dd>
                </div>
              </dl>
            </article>
          ))
        )}
      </div>

      <div className="table-scroll hidden overflow-x-auto rounded-lg border border-border bg-surface-elevated md:block">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-3" scope="col">
                <SortHeader
                  label="Player"
                  sortKey="name"
                  active={sort === "name"}
                  sortDirection={sortDirection}
                  defaultDir="asc"
                  href={href}
                />
              </th>
              <th className="px-3 py-3" scope="col">
                Team
              </th>
              <th className="px-3 py-3" scope="col">
                Pos
              </th>
              {SEASON_STAT_SORTS.map((column) => (
                <th key={column.key} className="px-3 py-3" scope="col">
                  <SortHeader
                    label={
                      column.key === "top10Finishes" ? topNLabel : column.label
                    }
                    sortKey={column.key}
                    active={sort === column.key}
                    sortDirection={sortDirection}
                    defaultDir={column.defaultDir}
                    href={href}
                    title={column.title}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={seasonColumnCount}
                  className="px-3 py-8 text-center text-muted"
                >
                  No qualified player results yet for this filter.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.rankableEntryId}
                  className="border-b border-border last:border-0"
                >
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
                    {row.top10Finishes}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-ink">
                    {formatPct(row.rankedPct)}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-ink">
                    {formatAvgRank(row.avgRankedPosition)}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-ink">
                    {row.weeksRecorded}
                    <span className="text-muted"> / {row.weeksEligible}</span>
                  </td>
                  <td className="px-3 py-3 tabular-nums text-ink">
                    {row.numberOneFinishes}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-ink">
                    {row.bestFinish ?? "—"}
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

function WeekTable({
  rows,
  sort,
  sortDirection,
  seasonId,
  href,
}: {
  rows: WeekPerformanceRow[];
  sort: WeekPerformanceSortKey;
  sortDirection: "asc" | "desc";
  seasonId: string;
  href: (next: {
    sort?: string;
    sortDirection?: "asc" | "desc";
  }) => string;
}) {
  const columnCount = 3 + WEEK_STAT_SORTS.length;

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-3 text-xs font-semibold uppercase tracking-wide text-muted">
        <span className="rounded-md bg-surface-elevated px-2 py-1 text-ink">
          Actual Finish
        </span>
        <span className="rounded-md bg-surface-elevated px-2 py-1 text-ink">
          Ranker Behavior
        </span>
        <span className="rounded-md bg-surface-elevated px-2 py-1 text-ink">
          Pregame Consensus
        </span>
      </div>

      <div className="space-y-3 md:hidden">
        {rows.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface-elevated px-3 py-8 text-center text-sm text-muted">
            No official finishes for this week and position.
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
                    Actual
                  </p>
                  <p className="font-display text-lg font-semibold tabular-nums text-ink">
                    #{row.actualRank}
                  </p>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-surface px-1.5 py-2">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Pts
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                    {row.fantasyPoints == null
                      ? "—"
                      : row.fantasyPoints.toFixed(1)}
                  </dd>
                </div>
                <div className="rounded-md bg-surface px-1.5 py-2">
                  <dt
                    className="text-[10px] font-semibold uppercase tracking-wide text-muted"
                    title={RANKED_PCT_TOOLTIP}
                  >
                    Ranked %
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                    {formatPct(row.rankedPct)}
                  </dd>
                </div>
                <div className="rounded-md bg-surface px-1.5 py-2">
                  <dt
                    className="text-[10px] font-semibold uppercase tracking-wide text-muted"
                    title={AVG_RANK_TOOLTIP}
                  >
                    Avg Rank
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                    {formatAvgRank(row.avgRankedPosition)}
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
              <th className="px-3 py-3" scope="col">
                <SortHeader
                  label="Player"
                  sortKey="name"
                  active={sort === "name"}
                  sortDirection={sortDirection}
                  defaultDir="asc"
                  href={href}
                />
              </th>
              <th className="px-3 py-3" scope="col">
                Team
              </th>
              <th className="px-3 py-3" scope="col">
                Pos
              </th>
              {WEEK_STAT_SORTS.map((column) => (
                <th key={column.key} className="px-3 py-3" scope="col">
                  <SortHeader
                    label={column.label}
                    sortKey={column.key}
                    active={sort === column.key}
                    sortDirection={sortDirection}
                    defaultDir={column.defaultDir}
                    href={href}
                    title={column.title}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columnCount}
                  className="px-3 py-8 text-center text-muted"
                >
                  No official finishes for this week and position.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.rankableEntryId}
                  className="border-b border-border last:border-0"
                >
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
                    {row.actualRank}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-ink">
                    {row.fantasyPoints == null
                      ? "—"
                      : row.fantasyPoints.toFixed(1)}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-ink">
                    {formatPct(row.rankedPct)}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-ink">
                    {formatAvgRank(row.avgRankedPosition)}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-ink">
                    {row.consensusRank ?? "—"}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-ink">
                    {formatPct(row.consensusSelectedPct)}
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
