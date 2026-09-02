"use client";

import { useMemo } from "react";
import type { PlayerPoolSortKey } from "@/lib/rank/player-pool-search";

export function PlayerPoolToolbar({
  query,
  onQueryChange,
  teamFilter,
  onTeamFilterChange,
  sortKey,
  onSortKeyChange,
  teamOptions,
  hasResearch,
  availableCount,
  researchWindowLabel,
  filteredCount,
  className = "",
}: {
  query: string;
  onQueryChange: (value: string) => void;
  teamFilter: string;
  onTeamFilterChange: (value: string) => void;
  sortKey: PlayerPoolSortKey;
  onSortKeyChange: (value: PlayerPoolSortKey) => void;
  teamOptions: string[];
  hasResearch: boolean;
  availableCount: number;
  researchWindowLabel?: string;
  filteredCount: number;
  className?: string;
}) {
  const sortOptions = useMemo(
    () =>
      [
        ["name", "A–Z"],
        ["team", "Team"],
        ...(hasResearch
          ? ([
              ["fantasyPointsPerGame", "FP/G"],
              ["averageFinish", "Avg finish"],
              ["top10Finishes", "Top 10"],
            ] as const)
          : []),
      ] as const,
    [hasResearch],
  );

  return (
    <div className={className}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2
            id="available-players-heading"
            className="font-display text-lg font-semibold text-ink"
          >
            Player pool
          </h2>
          <p className="mt-1 text-sm text-muted">
            {availableCount} available · {filteredCount} shown · neutral A–Z
            default
            {researchWindowLabel ? ` · ${researchWindowLabel}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <label className="sm:col-span-2">
          <span className="sr-only">Search players</span>
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search name, team, or alias"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </label>
        <label>
          <span className="sr-only">Filter by team</span>
          <select
            value={teamFilter}
            onChange={(event) => onTeamFilterChange(event.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          >
            <option value="">All teams</option>
            {teamOptions.map((team) => (
              <option key={team} value={team}>
                {team}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className="text-muted">Sort:</span>
        {sortOptions.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onSortKeyChange(key)}
            className={`rounded px-2 py-0.5 ${
              sortKey === key
                ? "bg-accent/15 font-medium text-accent"
                : "text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!hasResearch ? (
        <p className="mt-2 text-xs text-muted">
          No prior-week stats for this research window yet.
        </p>
      ) : null}
    </div>
  );
}
