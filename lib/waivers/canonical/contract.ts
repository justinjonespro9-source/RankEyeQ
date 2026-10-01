/**
 * Consumer pins for the SNG canonical NFL weekly performance artifact
 * (`sng-canonical-nfl-weekly-performance/1`, approved SNG checkpoint
 * 0b119c9d1b298f1650739c3bee116e0d8e9a298d). RankEyeQ verifies integrity and
 * structure only; it never re-scores facts or recomputes SNG's opaque inner
 * lineage fingerprints.
 */

export const SNG_CANONICAL_ARTIFACT_SCHEMA_VERSION = "sng-canonical-nfl-weekly-performance/1";
export const SNG_CANONICAL_SERIALIZATION_VERSION = "sng-canonical-json/1";
export const SNG_CANONICAL_CHECKSUM_ALGORITHM = "SHA-256";
export const SNG_COVERAGE_MANIFEST_CONTRACT_VERSION = "sng-weekly-coverage-manifest/1";
export const SNG_COVERAGE_MANIFEST_SCOPE = "ALL_WEEKLY_ELIGIBLE_SCORABLE_AND_UNRANKED_DISPOSITIONS";
export const SNG_READINESS_POLICY_VERSION = "sng-full-week-readiness/1";

export const SNG_RULESET_CODE = "SNG_NFL_HALF_PPR";
export const SNG_RULESET_VERSION = 1;
/** Approved definition checksum of SNG_NFL_HALF_PPR@1 (string pin; never recomputed here). */
export const SNG_RULESET_DEFINITION_CHECKSUM = "319a5440339415ec8de69c8f80de174198c4d2e717865c21e8be9b2119ba3004";
export const SNG_ENGINE_VERSION = "sng-nfl-fantasy-engine/1.0.0";
export const SNG_POSITION_POLICY_VERSION = "sng-nfl-weekly-position-eligibility/1.0.0";

export const SNG_LEAGUE = "NFL";
export const SNG_SEASON_TYPE = "REG";
export const SNG_MIN_SEASON = 2000;
export const SNG_MAX_SEASON = 2100;
export const SNG_MIN_WEEK = 1;
export const SNG_MAX_WEEK = 18;

/** Result sets appear in exactly this contract order. */
export const SNG_POSITIONS = ["QB", "RB", "WR", "TE", "DEF"] as const;
export type SngPosition = (typeof SNG_POSITIONS)[number];

export const SNG_PARTICIPANT_KINDS = ["PLAYER", "TEAM_DEFENSE"] as const;
export type SngParticipantKind = (typeof SNG_PARTICIPANT_KINDS)[number];

export const SNG_PARTICIPATION_STATES = [
  "PARTICIPATED_WITH_STATS",
  "PARTICIPATED_ZERO",
  "VERIFIED_NON_PARTICIPANT",
  "UNKNOWN_INCOMPLETE",
  "ABSENT_UNRESOLVED",
] as const;
export type SngParticipationState = (typeof SNG_PARTICIPATION_STATES)[number];
export const SNG_SCORABLE_STATES: ReadonlySet<SngParticipationState> = new Set(["PARTICIPATED_WITH_STATS", "PARTICIPATED_ZERO"]);
/** States that block SNG publication; an ACCEPTED artifact must never contain them. */
export const SNG_UNRESOLVED_STATES: ReadonlySet<SngParticipationState> = new Set(["UNKNOWN_INCOMPLETE", "ABSENT_UNRESOLVED"]);

export const SNG_PARTICIPANT_DISPOSITIONS = [
  "PLAYED",
  "DNP",
  "BYE",
  "CANCELLED_GAME",
  "MOVED_OUT_OF_WEEK",
  "NO_ROSTER_ASSIGNMENT",
  "UNRESOLVED",
] as const;
export type SngParticipantDisposition = (typeof SNG_PARTICIPANT_DISPOSITIONS)[number];

export const SNG_PARTICIPATION_PROOFS = [
  "COMPLETE_FACTUAL_LINE",
  "POSITIVE_SNAPS_COMPLETE_FACTS",
  "OFFICIAL_INACTIVE",
  "EXHAUSTIVE_GAME_PARTICIPATION",
  "WEEK_DISPOSITION",
  "NONE",
] as const;
export type SngParticipationProof = (typeof SNG_PARTICIPATION_PROOFS)[number];
export const SNG_SCORABLE_PROOFS: ReadonlySet<SngParticipationProof> = new Set(["COMPLETE_FACTUAL_LINE", "POSITIVE_SNAPS_COMPLETE_FACTS"]);
export const SNG_DNP_PROOFS: ReadonlySet<SngParticipationProof> = new Set(["OFFICIAL_INACTIVE", "EXHAUSTIVE_GAME_PARTICIPATION"]);

export const SNG_EVENT_DISPOSITIONS = ["PLAYED", "CANCELLED", "MOVED_OUT_OF_WEEK"] as const;
export type SngEventDisposition = (typeof SNG_EVENT_DISPOSITIONS)[number];

export const SNG_PARTICIPATION_CHANNELS = ["OFFENSE", "DEFENSE", "SPECIAL_TEAMS"] as const;
export const SNG_SOURCE_FINALITIES = ["FINAL", "CORRECTED"] as const;
export const SNG_DEF_POINTS_ALLOWED_POLICY = "OPPONENT_OFFICIAL_FINAL_GAME_TOTAL";

/** Consumer crosswalk namespaces the artifact must declare. */
export const RANKEYEQ_PLAYER_IDENTITY_PROVIDER = "nflcom-bootstrap";
export const SNG_DEFENSE_IDENTITY_PROVIDER = "sng-team";

/** Publication state carried by the SNG download header (not by the bytes). */
export const SNG_PUBLICATION_STATES = ["ACCEPTED", "SUPERSEDED", "WITHDRAWN"] as const;
export type SngPublicationState = (typeof SNG_PUBLICATION_STATES)[number];

export function sngSeriesKey(season: number, week: number): string {
  return `${SNG_LEAGUE}:${SNG_SEASON_TYPE}:${season}:${week}:${SNG_RULESET_CODE}@${SNG_RULESET_VERSION}:${SNG_POSITION_POLICY_VERSION}`;
}

/** Upper bound on accepted artifact text (full-week evidence is large but finite). */
export const SNG_CANONICAL_MAX_ARTIFACT_CHARS = 64 * 1024 * 1024;
