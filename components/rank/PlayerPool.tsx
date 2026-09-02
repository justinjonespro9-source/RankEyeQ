"use client";

import { useMemo, useState } from "react";
import { PlayerCard } from "@/components/rank/PlayerCard";
import { PlayerPoolToolbar } from "@/components/rank/PlayerPoolToolbar";
import {
  filterAndSortPlayerPool,
  formatResearchStat,
  poolHasResearch,
  type PlayerPoolSortKey,
} from "@/lib/rank/player-pool-search";
import type { Position, RankingPlayer } from "@/types/contest";

export type { PlayerPoolSortKey };

export function PlayerPool({
  players,
  rankedIds,
  disabled,
  allFilled = false,
  kickoffLockedIds = new Set<string>(),
  onAdd,
  teams = [],
  researchWindowLabel,
  slotCount,
  initialSort = "name",
  toolbarClassName = "",
  listClassName = "",
  mode = "full",
  filterState: controlledFilterState,
  onFilterStateChange,
}: {
  players: RankingPlayer[];
  rankedIds: Set<string>;
  disabled: boolean;
  allFilled?: boolean;
  kickoffLockedIds?: Set<string>;
  onAdd: (player: RankingPlayer) => void;
  teams?: string[];
  researchWindowLabel?: string;
  slotCount: number;
  initialSort?: PlayerPoolSortKey;
  toolbarClassName?: string;
  listClassName?: string;
  mode?: "full" | "toolbar" | "list";
  filterState?: {
    query: string;
    teamFilter: string;
    sortKey: PlayerPoolSortKey;
  };
  onFilterStateChange?: (state: {
    query: string;
    teamFilter: string;
    sortKey: PlayerPoolSortKey;
  }) => void;
}) {
  const [internalQuery, setInternalQuery] = useState("");
  const [internalTeamFilter, setInternalTeamFilter] = useState("");
  const [internalSortKey, setInternalSortKey] =
    useState<PlayerPoolSortKey>(initialSort);
  const [viewMode, setViewMode] = useState<"list" | "table">("list");

  const query = controlledFilterState?.query ?? internalQuery;
  const teamFilter = controlledFilterState?.teamFilter ?? internalTeamFilter;
  const sortKey = controlledFilterState?.sortKey ?? internalSortKey;

  function setQuery(value: string) {
    if (onFilterStateChange && controlledFilterState) {
      onFilterStateChange({ ...controlledFilterState, query: value });
    } else {
      setInternalQuery(value);
    }
  }
  function setTeamFilter(value: string) {
    if (onFilterStateChange && controlledFilterState) {
      onFilterStateChange({ ...controlledFilterState, teamFilter: value });
    } else {
      setInternalTeamFilter(value);
    }
  }
  function setSortKey(value: PlayerPoolSortKey) {
    if (onFilterStateChange && controlledFilterState) {
      onFilterStateChange({ ...controlledFilterState, sortKey: value });
    } else {
      setInternalSortKey(value);
    }
  }

  const teamOptions = useMemo(() => {
    if (teams.length > 0) return [...teams].sort();
    return [...new Set(players.map((player) => player.team))].sort();
  }, [players, teams]);

  const hasResearch = poolHasResearch(players);

  const filtered = useMemo(
    () =>
      filterAndSortPlayerPool(players, {
        query,
        teamFilter,
        sortKey,
      }),
    [players, query, teamFilter, sortKey],
  );

  const availableCount = players.filter((player) => !rankedIds.has(player.id)).length;

  function handleAdd(player: RankingPlayer) {
    if (allFilled) return;
    onAdd(player);
  }

  const toolbar = (
    <PlayerPoolToolbar
      query={query}
      onQueryChange={setQuery}
      teamFilter={teamFilter}
      onTeamFilterChange={setTeamFilter}
      sortKey={sortKey}
      onSortKeyChange={setSortKey}
      teamOptions={teamOptions}
      hasResearch={hasResearch}
      availableCount={availableCount}
      researchWindowLabel={researchWindowLabel}
      filteredCount={filtered.length}
      className={toolbarClassName}
    />
  );

  const listSection = (
    <>
      {viewMode === "table" && hasResearch ? (
        <div className="hidden overflow-x-auto overscroll-contain sm:block lg:flex-1">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="sticky top-0 border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Player</th>
                <th className="px-3 py-2">Team</th>
                <th className="px-3 py-2">FP/G</th>
                <th className="px-3 py-2">Avg Fin</th>
                <th className="px-3 py-2">Top 10</th>
                <th className="px-3 py-2">Add</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((player) => {
                const ranked = rankedIds.has(player.id);
                const kickoffLocked =
                  kickoffLockedIds.has(player.id) && !ranked;
                const disabledRow =
                  disabled || ranked || kickoffLocked || allFilled;
                const r = player.research;
                return (
                  <tr
                    key={player.id}
                    className={`border-b border-border last:border-0 ${
                      disabledRow ? "opacity-50" : "hover:bg-surface"
                    }`}
                  >
                    <td className="px-3 py-2 font-medium text-ink">
                      {player.name}
                    </td>
                    <td className="px-3 py-2 text-ink">{player.team}</td>
                    <td className="px-3 py-2 tabular-nums text-ink">
                      {formatResearchStat(r?.fantasyPointsPerGame, {
                        decimals: 1,
                      })}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-ink">
                      {formatResearchStat(r?.averageFinish, { decimals: 1 })}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-ink">
                      {formatResearchStat(r?.top10Finishes)}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        disabled={disabledRow}
                        onClick={() => handleAdd(player)}
                        className="rounded-md border border-border px-2 py-1 text-xs font-medium text-ink hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {ranked ? "Added" : "Add"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <ul
        className={`space-y-1 overflow-y-auto overscroll-contain p-2 sm:p-3 lg:flex-1 ${listClassName} ${
          viewMode === "table" && hasResearch ? "sm:hidden" : ""
        }`}
        data-dnd-region="player-pool"
      >
        {filtered.map((player) => {
          const ranked = rankedIds.has(player.id);
          const kickoffLocked = kickoffLockedIds.has(player.id) && !ranked;
          const rowDisabled = disabled || ranked || kickoffLocked;
          return (
            <li key={player.id}>
              <PlayerCard
                player={player}
                ranked={ranked}
                disabled={rowDisabled}
                compact
                onClick={() => handleAdd(player)}
                trailing={
                  ranked ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Added
                    </span>
                  ) : allFilled ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Full
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={rowDisabled}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleAdd(player);
                      }}
                      className="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Add
                    </button>
                  )
                }
              />
            </li>
          );
        })}
        {filtered.length === 0 ? (
          <li className="px-3 py-8 text-center text-sm text-muted">
            {query.trim() || teamFilter
              ? "No players match your search or team filter."
              : "No eligible players in this pool."}
          </li>
        ) : null}
      </ul>
    </>
  );

  if (mode === "toolbar") {
    return (
      <section
        aria-labelledby="available-players-heading"
        className="rounded-lg border border-border bg-surface-elevated"
      >
        <div className="px-4 py-3 sm:px-5">{toolbar}</div>
      </section>
    );
  }

  if (mode === "list") {
    return (
      <section
        aria-label="Eligible players"
        className="flex min-h-0 flex-col rounded-lg border border-border bg-surface-elevated"
      >
        {allFilled ? (
          <div className="border-b border-border px-4 py-3 text-sm text-warning">
            Your Top {slotCount} is full. Remove a player to add someone else.
          </div>
        ) : null}
        {listSection}
      </section>
    );
  }

  return (
    <section
      aria-labelledby="available-players-heading"
      className="flex min-h-0 flex-col rounded-lg border border-border bg-surface-elevated lg:max-h-[calc(100vh-12rem)]"
    >
      <div className="border-b border-border px-4 py-3 sm:px-5">
        {toolbar}
        {hasResearch ? (
          <div className="mt-3 flex justify-end">
            <div className="flex rounded-md border border-border text-xs">
              <button
                type="button"
                className={`px-2 py-1 ${viewMode === "list" ? "bg-surface text-ink" : "text-muted"}`}
                onClick={() => setViewMode("list")}
              >
                List
              </button>
              <button
                type="button"
                className={`hidden px-2 py-1 sm:inline ${viewMode === "table" ? "bg-surface text-ink" : "text-muted"}`}
                onClick={() => setViewMode("table")}
              >
                Stats
              </button>
            </div>
          </div>
        ) : null}
        {allFilled ? (
          <p className="mt-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
            Your Top {slotCount} is full. Remove a player to add someone else.
          </p>
        ) : null}
      </div>

      {listSection}
    </section>
  );
}

export function positionStatColumns(position: Position): string[] {
  if (position === "qb") {
    return ["Pass Yds", "Pass TD", "INT", "Rush Yds"];
  }
  return ["Rec", "Rush Yds", "Rec Yds", "TD"];
}
