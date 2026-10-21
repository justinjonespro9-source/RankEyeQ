/**
 * RankEyeQ batch statistical component CSV contract (V1).
 *
 * Designed so a future SNG LABS Master Stats Engine can emit the same columns.
 * Fantasy points are never imported — RankEyeQ scores via FantasyTrack shared engine.
 */

export const STAT_COMPONENTS_FORMAT_VERSION = "rankeyeq-stat-components/1" as const;

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

export const PLAYER_STAT_COLUMNS = [
  "passingYards",
  "passingTds",
  "interceptions",
  "rushingYards",
  "rushingTds",
  "receptions",
  "receivingYards",
  "receivingTds",
  "twoPointConversions",
  "fumblesLost",
  "returnTds",
] as const;

export const DEFENSE_STAT_COLUMNS = [
  "sacks",
  "interceptions",
  "fumbleRecoveries",
  "defensiveTds",
  "specialTeamsTds",
  "safeties",
  "blockedKicks",
  "pointsAllowed",
] as const;

export type PlayerStatColumn = (typeof PLAYER_STAT_COLUMNS)[number];
export type DefenseStatColumn = (typeof DEFENSE_STAT_COLUMNS)[number];

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
