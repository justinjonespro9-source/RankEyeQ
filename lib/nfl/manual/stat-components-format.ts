/**
 * RankEyeQ batch statistical component CSV contract (V1.1).
 *
 * Designed so a future SNG LABS Master Stats Engine can emit the same columns.
 * Fantasy points are never imported — RankEyeQ scores via FantasyTrack shared engine.
 *
 * v1.1: `passingInterceptions` / `defenseInterceptions` replace the ambiguous
 * duplicate `interceptions` header that appeared when PLAYER+DEF columns shared
 * one CSV row layout.
 */

export const STAT_COMPONENTS_FORMAT_VERSION = "rankeyeq-stat-components/1.1" as const;

export const STAT_COMPONENTS_COMMON_COLUMNS = [
  "recordType",
  "formatVersion",
  "seasonYear",
  "weekNumber",
  "rankableEntryId",
  "provider",
  "externalId",
  "gameExternalId",
  "team",
  "position",
  "displayName",
  "sourceLabel",
  "sourceUrl",
  "observedAt",
] as const;

/** CSV headers for offensive players — maps onto PlayerStatLine. */
export const PLAYER_CSV_COLUMNS = [
  "passingYards",
  "passingTds",
  "passingInterceptions",
  "rushingYards",
  "rushingTds",
  "receptions",
  "receivingYards",
  "receivingTds",
  "twoPointConversions",
  "fumblesLost",
  "returnTds",
] as const;

/** CSV headers for D/ST — maps onto DefenseStatLine. */
export const DEFENSE_CSV_COLUMNS = [
  "sacks",
  "defenseInterceptions",
  "fumbleRecoveries",
  "defensiveTds",
  "specialTeamsTds",
  "safeties",
  "blockedKicks",
  "pointsAllowed",
] as const;

export type PlayerCsvColumn = (typeof PLAYER_CSV_COLUMNS)[number];
export type DefenseCsvColumn = (typeof DEFENSE_CSV_COLUMNS)[number];

/** CSV column → PlayerStatLine field (scoring / WeekStat). */
export const PLAYER_CSV_TO_STAT = {
  passingYards: "passingYards",
  passingTds: "passingTds",
  passingInterceptions: "interceptions",
  rushingYards: "rushingYards",
  rushingTds: "rushingTds",
  receptions: "receptions",
  receivingYards: "receivingYards",
  receivingTds: "receivingTds",
  twoPointConversions: "twoPointConversions",
  fumblesLost: "fumblesLost",
  returnTds: "returnTds",
} as const satisfies Record<PlayerCsvColumn, string>;

/** CSV column → DefenseStatLine field (scoring / WeekStat). */
export const DEFENSE_CSV_TO_STAT = {
  sacks: "sacks",
  defenseInterceptions: "interceptions",
  fumbleRecoveries: "fumbleRecoveries",
  defensiveTds: "defensiveTds",
  specialTeamsTds: "specialTeamsTds",
  safeties: "safeties",
  blockedKicks: "blockedKicks",
  pointsAllowed: "pointsAllowed",
} as const satisfies Record<DefenseCsvColumn, string>;

/** @deprecated Use PLAYER_CSV_COLUMNS — kept alias for older call sites during rename. */
export const PLAYER_STAT_COLUMNS = PLAYER_CSV_COLUMNS;
/** @deprecated Use DEFENSE_CSV_COLUMNS */
export const DEFENSE_STAT_COLUMNS = DEFENSE_CSV_COLUMNS;

export type PlayerStatColumn = PlayerCsvColumn;
export type DefenseStatColumn = DefenseCsvColumn;

export const STAT_COMPONENTS_IMPORT_TYPE = "STAT_COMPONENTS" as const;

/** CSV escape: quote when needed. */
export function csvEscape(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function csvJoin(values: Array<string | number | null | undefined>): string {
  return values.map(csvEscape).join(",");
}

/** All component headers must be unique across PLAYER + DEF. */
export function assertUniqueStatCsvHeaders(): void {
  const all = [...PLAYER_CSV_COLUMNS, ...DEFENSE_CSV_COLUMNS];
  const seen = new Set<string>();
  for (const col of all) {
    if (seen.has(col)) {
      throw new Error(`Duplicate stat CSV header in format contract: ${col}`);
    }
    seen.add(col);
  }
}
