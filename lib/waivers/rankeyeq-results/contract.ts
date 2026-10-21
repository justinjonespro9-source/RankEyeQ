/**
 * Pins for the RankEyeQ final-week-stats results source
 * (`rankeyeq-final-week-stats/1`). This is a second, product-approved source of
 * Waiver results alongside the SNG canonical artifact. It is derived from
 * RankEyeQ's own already-calculated PlayerWeekStat / DefenseWeekStat rows plus
 * operator participation reviews, and it never impersonates SNG: nothing here
 * uses an SNG schema version, ruleset, team key or crosswalk.
 */

export const RANKEYEQ_FINAL_WEEK_STATS_SCHEMA_VERSION = "rankeyeq-final-week-stats/1";
export const RANKEYEQ_FINAL_WEEK_STATS_SOURCE_KIND = "RANKEYEQ_FINAL_WEEK_STATS";

/** Recorded on each snapshot (the database accepts only this basis). */
export const RANKEYEQ_RESULTS_AUTHORITY_BASIS = "RANKEYEQ_OPERATOR_ATTESTED";
/** Shown wherever a RankEyeQ results snapshot or its authority is displayed. */
export const RANKEYEQ_RESULTS_AUTHORITY_LABEL = "RankEyeQ operator attested — derived from RankEyeQ final week stats (not SNG)";

export const RANKEYEQ_RESULTS_ATTESTATION_VERSION = "rankeyeq-final-week-stats-attestation/1";
export const RANKEYEQ_RESULTS_ATTESTATION_TEXT =
  "As an authenticated RankEyeQ administrator, I reviewed this week's final RankEyeQ stat lines and the participation decisions for every " +
  "zero-point player or defense. I understand this snapshot is derived from RankEyeQ's own WeekStat rows and my attestations, and is not an " +
  "SNG artifact, and that a zero fantasy-point line alone never proves a player did not play.";

/** Scoring ruleset pin: the WeekStat fantasy points must already be calculated under this version. */
export const RANKEYEQ_FANTASY_SCORING_VERSION = "FANTASYTRACK_NFL_HALF_PPR_V2";

/** The only WeekStat provider whose rows are final RankEyeQ operator-verified lines. */
export const RANKEYEQ_WEEK_STAT_PROVIDER = "manual";
/** Required `Week.status` for a results snapshot. */
export const RANKEYEQ_REQUIRED_WEEK_STATUS = "COMPLETE";
/** Required `NflGame.status` for every game that backs a stat line. */
export const RANKEYEQ_REQUIRED_GAME_STATUS = "FINAL";

/** Frozen identity namespace: RankableEntry provider for players and `def-{TEAM}` defenses. */
export const RANKEYEQ_IDENTITY_PROVIDER = "nflcom-bootstrap";
export const RANKEYEQ_DEF_EXTERNAL_ID_PREFIX = "def-";

export const RANKEYEQ_POSITIONS = ["QB", "RB", "WR", "TE", "DEF"] as const;
export type RankEyeQResultsPosition = (typeof RANKEYEQ_POSITIONS)[number];

export const RANKEYEQ_PARTICIPANT_KINDS = ["PLAYER", "TEAM_DEFENSE"] as const;
export type RankEyeQParticipantKind = (typeof RANKEYEQ_PARTICIPANT_KINDS)[number];

/**
 * Participation states. PARTICIPATED_WITH_STATS / PARTICIPATED_ZERO /
 * VERIFIED_NON_PARTICIPANT are the SNG-compatible vocabulary; the two
 * unresolved states block an ACCEPTED snapshot:
 *   PENDING_ZERO_REVIEW  a zero-point WeekStat row awaiting operator review
 *   ABSENT_UNRESOLVED    no usable final WeekStat row (missing is never zero)
 */
export const RANKEYEQ_PARTICIPATION_STATES = [
  "PARTICIPATED_WITH_STATS",
  "PARTICIPATED_ZERO",
  "VERIFIED_NON_PARTICIPANT",
  "PENDING_ZERO_REVIEW",
  "ABSENT_UNRESOLVED",
] as const;
export type RankEyeQParticipationState = (typeof RANKEYEQ_PARTICIPATION_STATES)[number];
export const RANKEYEQ_SCORABLE_STATES: ReadonlySet<RankEyeQParticipationState> = new Set(["PARTICIPATED_WITH_STATS", "PARTICIPATED_ZERO"]);
export const RANKEYEQ_UNRESOLVED_STATES: ReadonlySet<RankEyeQParticipationState> = new Set(["PENDING_ZERO_REVIEW", "ABSENT_UNRESOLVED"]);

export const RANKEYEQ_PARTICIPANT_DISPOSITIONS = ["PLAYED", "DNP", "UNRESOLVED"] as const;
export type RankEyeQParticipantDisposition = (typeof RANKEYEQ_PARTICIPANT_DISPOSITIONS)[number];

export const RANKEYEQ_PARTICIPATION_PROOFS = [
  "WEEK_STAT_LINE",
  "OPERATOR_PLAYED_ZERO_REVIEW",
  "OPERATOR_DID_NOT_PLAY_REVIEW",
  "NONE",
] as const;
export type RankEyeQParticipationProof = (typeof RANKEYEQ_PARTICIPATION_PROOFS)[number];

/** Operator decisions a zero-point review can carry (PENDING leaves the participant unresolved). */
export const RANKEYEQ_ZERO_POINT_DECISIONS = ["PENDING", "PLAYED_ZERO", "DID_NOT_PLAY"] as const;
export type RankEyeQZeroPointDecision = (typeof RANKEYEQ_ZERO_POINT_DECISIONS)[number];

export const RANKEYEQ_PUBLICATION_STATES = ["ACCEPTED", "SUPERSEDED", "WITHDRAWN"] as const;
export type RankEyeQPublicationState = (typeof RANKEYEQ_PUBLICATION_STATES)[number];

export const RANKEYEQ_EVIDENCE_REFERENCE_MAX = 500;
export const RANKEYEQ_DECISION_REASON_MAX = 1000;

export function rankEyeQDefenseExternalId(team: string): string {
  return `${RANKEYEQ_DEF_EXTERNAL_ID_PREFIX}${team}`;
}

export function rankEyeQResultsSeriesKey(season: number, weekNumber: number): string {
  return `NFL:${season}:${weekNumber}:${RANKEYEQ_FINAL_WEEK_STATS_SOURCE_KIND}@1:${RANKEYEQ_FANTASY_SCORING_VERSION}`;
}
