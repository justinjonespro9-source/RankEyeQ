/**
 * Explicit RankEyeQ ↔ SNG NFL team crosswalk. Nothing is derived by
 * abbreviation similarity: a team absent from this table is unmapped.
 *
 * SNG carries two team codes. `sngAbbreviation` is its ingestion abbreviation
 * (Washington is WSH where RankEyeQ uses WAS). `sngTeamKey` is the stable
 * `Team.key` that the canonical artifact uses as `teamKey`, event team keys
 * and the `sng-team` DEF externalId. Canonical matching uses `sngTeamKey`.
 *
 * Source: sng-labs 0b119c9d1b298f1650739c3bee116e0d8e9a298d
 * lib/game-day/nfl-foundation.ts. Producer fixture confirmation is pending.
 */

export const RANKEYEQ_SNG_TEAM_CROSSWALK_VERSION = "rankeyeq-sng-team-crosswalk/1";
export const RANKEYEQ_SNG_TEAM_CROSSWALK_STATUS = "SOURCE_DERIVED_PENDING_PRODUCER_FIXTURE" as const;

export type TeamCrosswalkRow = {
  rankeyeqTeam: string;
  sngAbbreviation: string;
  sngTeamKey: string;
};

export const RANKEYEQ_SNG_TEAM_CROSSWALK: readonly TeamCrosswalkRow[] = [
  { rankeyeqTeam: "ARI", sngAbbreviation: "ARI", sngTeamKey: "arizona-cardinals" },
  { rankeyeqTeam: "ATL", sngAbbreviation: "ATL", sngTeamKey: "atlanta-falcons" },
  { rankeyeqTeam: "BAL", sngAbbreviation: "BAL", sngTeamKey: "baltimore-ravens" },
  { rankeyeqTeam: "BUF", sngAbbreviation: "BUF", sngTeamKey: "buffalo-bills" },
  { rankeyeqTeam: "CAR", sngAbbreviation: "CAR", sngTeamKey: "carolina-panthers" },
  { rankeyeqTeam: "CHI", sngAbbreviation: "CHI", sngTeamKey: "chicago-bears" },
  { rankeyeqTeam: "CIN", sngAbbreviation: "CIN", sngTeamKey: "cincinnati-bengals" },
  { rankeyeqTeam: "CLE", sngAbbreviation: "CLE", sngTeamKey: "cleveland-browns" },
  { rankeyeqTeam: "DAL", sngAbbreviation: "DAL", sngTeamKey: "dallas-cowboys" },
  { rankeyeqTeam: "DEN", sngAbbreviation: "DEN", sngTeamKey: "denver-broncos" },
  { rankeyeqTeam: "DET", sngAbbreviation: "DET", sngTeamKey: "detroit-lions" },
  { rankeyeqTeam: "GB", sngAbbreviation: "GB", sngTeamKey: "green-bay-packers" },
  { rankeyeqTeam: "HOU", sngAbbreviation: "HOU", sngTeamKey: "houston-texans" },
  { rankeyeqTeam: "IND", sngAbbreviation: "IND", sngTeamKey: "indianapolis-colts" },
  { rankeyeqTeam: "JAX", sngAbbreviation: "JAX", sngTeamKey: "jacksonville-jaguars" },
  { rankeyeqTeam: "KC", sngAbbreviation: "KC", sngTeamKey: "kansas-city-chiefs" },
  { rankeyeqTeam: "LV", sngAbbreviation: "LV", sngTeamKey: "las-vegas-raiders" },
  { rankeyeqTeam: "LAC", sngAbbreviation: "LAC", sngTeamKey: "los-angeles-chargers" },
  { rankeyeqTeam: "LAR", sngAbbreviation: "LAR", sngTeamKey: "los-angeles-rams" },
  { rankeyeqTeam: "MIA", sngAbbreviation: "MIA", sngTeamKey: "miami-dolphins" },
  { rankeyeqTeam: "MIN", sngAbbreviation: "MIN", sngTeamKey: "minnesota-vikings" },
  { rankeyeqTeam: "NE", sngAbbreviation: "NE", sngTeamKey: "new-england-patriots" },
  { rankeyeqTeam: "NO", sngAbbreviation: "NO", sngTeamKey: "new-orleans-saints" },
  { rankeyeqTeam: "NYG", sngAbbreviation: "NYG", sngTeamKey: "new-york-giants" },
  { rankeyeqTeam: "NYJ", sngAbbreviation: "NYJ", sngTeamKey: "new-york-jets" },
  { rankeyeqTeam: "PHI", sngAbbreviation: "PHI", sngTeamKey: "philadelphia-eagles" },
  { rankeyeqTeam: "PIT", sngAbbreviation: "PIT", sngTeamKey: "pittsburgh-steelers" },
  { rankeyeqTeam: "SF", sngAbbreviation: "SF", sngTeamKey: "san-francisco-49ers" },
  { rankeyeqTeam: "SEA", sngAbbreviation: "SEA", sngTeamKey: "seattle-seahawks" },
  { rankeyeqTeam: "TB", sngAbbreviation: "TB", sngTeamKey: "tampa-bay-buccaneers" },
  { rankeyeqTeam: "TEN", sngAbbreviation: "TEN", sngTeamKey: "tennessee-titans" },
  { rankeyeqTeam: "WAS", sngAbbreviation: "WSH", sngTeamKey: "washington-commanders" },
];

const BY_RANKEYEQ = new Map(RANKEYEQ_SNG_TEAM_CROSSWALK.map((row) => [row.rankeyeqTeam, row]));
const BY_SNG_KEY = new Map(RANKEYEQ_SNG_TEAM_CROSSWALK.map((row) => [row.sngTeamKey, row]));

/** Exact lookup by RankEyeQ team code; no case folding, trimming or aliasing. */
export function sngTeamForRankEyeQTeam(rankeyeqTeam: string): TeamCrosswalkRow | null {
  return BY_RANKEYEQ.get(rankeyeqTeam) ?? null;
}

/** Exact lookup by SNG stable team key. */
export function rankEyeQTeamForSngTeamKey(sngTeamKey: string): TeamCrosswalkRow | null {
  return BY_SNG_KEY.get(sngTeamKey) ?? null;
}

const RANKEYEQ_DEF_EXTERNAL_ID = /^def-([A-Z]{2,3})$/;

/** RankEyeQ DEF identity is `nflcom-bootstrap` + `def-{TEAM}`; returns TEAM or null. */
export function rankEyeQDefenseTeamFromExternalId(externalId: string): string | null {
  return RANKEYEQ_DEF_EXTERNAL_ID.exec(externalId)?.[1] ?? null;
}
