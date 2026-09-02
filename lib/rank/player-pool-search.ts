import { normalizePlayerName } from "@/lib/nfl/player-identity";
import type { RankingPlayer } from "@/types/contest";

export type PlayerPoolSortKey =
  | "name"
  | "team"
  | "fantasyPointsPerGame"
  | "averageFinish"
  | "top10Finishes";

export type PlayerPoolFilterState = {
  query: string;
  teamFilter: string;
  sortKey: PlayerPoolSortKey;
};

export function normalizePoolQuery(value: string): string {
  return value.trim().toLowerCase();
}

export function playerSearchHaystacks(player: RankingPlayer): string[] {
  const values = [
    player.name,
    player.team,
    player.opponent,
    ...(player.searchKeys ?? []),
  ];
  const normalized = values.map((value) => normalizePlayerName(value));
  return [...new Set([...values.map((v) => v.toLowerCase()), ...normalized])];
}

export function matchesPlayerPoolQuery(
  player: RankingPlayer,
  rawQuery: string,
): boolean {
  const query = normalizePoolQuery(rawQuery);
  if (!query) return true;
  const needle = normalizePlayerName(query);
  return playerSearchHaystacks(player).some((haystack) => {
    const normalizedHaystack = normalizePlayerName(haystack);
    return (
      haystack.includes(query) ||
      normalizedHaystack.includes(needle) ||
      needle.includes(normalizedHaystack)
    );
  });
}

export function filterAndSortPlayerPool(
  players: RankingPlayer[],
  filters: PlayerPoolFilterState,
): RankingPlayer[] {
  let rows = players;
  if (filters.teamFilter) {
    rows = rows.filter((player) => player.team === filters.teamFilter);
  }
  if (filters.query.trim()) {
    rows = rows.filter((player) =>
      matchesPlayerPoolQuery(player, filters.query),
    );
  }

  return [...rows].sort((a, b) => comparePlayersBySortKey(a, b, filters.sortKey));
}

function comparePlayersBySortKey(
  a: RankingPlayer,
  b: RankingPlayer,
  sortKey: PlayerPoolSortKey,
): number {
  if (sortKey === "name") return a.name.localeCompare(b.name);
  if (sortKey === "team") {
    const teamDiff = a.team.localeCompare(b.team);
    return teamDiff !== 0 ? teamDiff : a.name.localeCompare(b.name);
  }

  const left = a.research;
  const right = b.research;
  if (!left && !right) return a.name.localeCompare(b.name);
  if (!left) return 1;
  if (!right) return -1;

  if (sortKey === "fantasyPointsPerGame") {
    return (
      (right.fantasyPointsPerGame ?? -1) - (left.fantasyPointsPerGame ?? -1)
    );
  }
  if (sortKey === "averageFinish") {
    return (left.averageFinish ?? 999) - (right.averageFinish ?? 999);
  }
  if (sortKey === "top10Finishes") {
    return right.top10Finishes - left.top10Finishes;
  }
  return a.name.localeCompare(b.name);
}

export function formatResearchStat(
  value: number | null | undefined,
  options?: { decimals?: number; suffix?: string },
): string {
  if (value == null || Number.isNaN(value)) return "—";
  const formatted =
    options?.decimals != null ? value.toFixed(options.decimals) : String(value);
  return options?.suffix ? `${formatted}${options.suffix}` : formatted;
}

export function poolHasResearch(players: RankingPlayer[]): boolean {
  return players.some(
    (player) =>
      player.research != null &&
      (player.research.gamesPlayed > 0 || player.research.weeksInWindow > 0),
  );
}
