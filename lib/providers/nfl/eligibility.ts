/**
 * RankIQ weekly slates cover Wednesday–Monday NFL games (ET).
 * 2026 Week 1 opens Wednesday; bye teams / missing kickoffs are not eligible.
 */
import {
  normalizeTeamAbbr,
  teamCodesMatch,
} from "@/lib/nfl/manual/parse-common";

const ELIGIBLE_WEEKDAYS = new Set([3, 4, 5, 6, 0, 1]); // Wed–Mon in JS getDay() for ET

export function isThursdayThroughMonday(startsAt: Date): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "America/New_York",
  }).format(startsAt);

  return (
    weekday === "Wed" ||
    weekday === "Thu" ||
    weekday === "Fri" ||
    weekday === "Sat" ||
    weekday === "Sun" ||
    weekday === "Mon"
  );
}

export function formatOpponentLabel(
  team: string,
  homeTeam: string,
  awayTeam: string,
): string {
  const home = normalizeTeamAbbr(homeTeam);
  const away = normalizeTeamAbbr(awayTeam);
  if (teamCodesMatch(team, homeTeam)) return `vs ${away}`;
  if (teamCodesMatch(team, awayTeam)) return `@ ${home}`;
  return "TBD";
}

export function shortPlayerName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return fullName;
  return parts[parts.length - 1] ?? fullName;
}

/** Used by tests that prefer numeric weekday checks. */
export function eligibleWeekdaySet() {
  return ELIGIBLE_WEEKDAYS;
}

export function findGameForTeam<
  T extends { homeTeam: string; awayTeam: string },
>(games: T[], team: string): T | undefined {
  return games.find(
    (game) =>
      teamCodesMatch(game.homeTeam, team) || teamCodesMatch(game.awayTeam, team),
  );
}

/**
 * Resolve a team's week game with ambiguity detection.
 * Prefer this over findGameForTeam when linking ContestEntry.gameId —
 * never guess when a team appears on more than one game.
 */
export type WeekGameResolution<T> =
  | { status: "unique"; game: T }
  | { status: "ambiguous"; games: T[] }
  | { status: "none" };

export function resolveWeekGameForTeam<
  T extends { homeTeam: string; awayTeam: string },
>(games: T[], team: string): WeekGameResolution<T> {
  const matches = games.filter(
    (game) =>
      teamCodesMatch(game.homeTeam, team) || teamCodesMatch(game.awayTeam, team),
  );
  if (matches.length === 0) return { status: "none" };
  if (matches.length > 1) return { status: "ambiguous", games: matches };
  return { status: "unique", game: matches[0]! };
}
