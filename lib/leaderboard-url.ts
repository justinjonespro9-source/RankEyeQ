export type LeaderboardDiscipline = "rankings" | "waivers";

export function parseLeaderboardDiscipline(raw: string | undefined): LeaderboardDiscipline {
  return raw === "waivers" ? "waivers" : "rankings";
}

/**
 * `/leaderboards` URL for a board selection. Rankings omits `discipline` so
 * every pre-Waivers Rankings URL keeps resolving to the same board.
 */
export function leaderboardHref(input: {
  discipline: LeaderboardDiscipline;
  scope: string;
  position: string;
  filter: string;
  week?: number | null;
}): string {
  const query = new URLSearchParams();
  if (input.discipline === "waivers") query.set("discipline", "waivers");
  query.set("scope", input.scope);
  query.set("position", input.position);
  query.set("filter", input.filter);
  if (input.week != null) query.set("week", String(input.week));
  return `/leaderboards?${query.toString()}`;
}
