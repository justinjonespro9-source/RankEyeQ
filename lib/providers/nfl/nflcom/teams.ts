import { NFL_TEAMS } from "@/lib/nfl-schedule";

/** NFL.com team slug → abbreviation (all 32 teams). */
export const NFL_COM_TEAM_SLUGS: Record<string, string> = {
  "arizona-cardinals": "ARI",
  "atlanta-falcons": "ATL",
  "baltimore-ravens": "BAL",
  "buffalo-bills": "BUF",
  "carolina-panthers": "CAR",
  "chicago-bears": "CHI",
  "cincinnati-bengals": "CIN",
  "cleveland-browns": "CLE",
  "dallas-cowboys": "DAL",
  "denver-broncos": "DEN",
  "detroit-lions": "DET",
  "green-bay-packers": "GB",
  "houston-texans": "HOU",
  "indianapolis-colts": "IND",
  "jacksonville-jaguars": "JAX",
  "kansas-city-chiefs": "KC",
  "las-vegas-raiders": "LV",
  "los-angeles-chargers": "LAC",
  "los-angeles-rams": "LAR",
  "miami-dolphins": "MIA",
  "minnesota-vikings": "MIN",
  "new-england-patriots": "NE",
  "new-orleans-saints": "NO",
  "new-york-giants": "NYG",
  "new-york-jets": "NYJ",
  "philadelphia-eagles": "PHI",
  "pittsburgh-steelers": "PIT",
  "san-francisco-49ers": "SF",
  "seattle-seahawks": "SEA",
  "tampa-bay-buccaneers": "TB",
  "tennessee-titans": "TEN",
  "washington-commanders": "WAS",
};

export const NFL_COM_ROSTER_SITEMAP_URL =
  "https://www.nfl.com/sitemap/players-roster.xml";

export const NFL_COM_ROSTER_SOURCE_LABEL =
  "NFL.com 2026 official team roster pages (bootstrap)";

export function teamSlugFromName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function rosterUrlForTeamSlug(slug: string) {
  return `https://www.nfl.com/teams/${slug}/roster/`;
}

export function allNflComRosterUrls() {
  return Object.keys(NFL_COM_TEAM_SLUGS).map((slug) => rosterUrlForTeamSlug(slug));
}

export function abbreviationForTeamSlug(slug: string) {
  return NFL_COM_TEAM_SLUGS[slug] ?? null;
}

export function teamNameForAbbreviation(abbr: string) {
  return NFL_TEAMS.find((team) => team.abbr === abbr)?.name ?? abbr;
}
