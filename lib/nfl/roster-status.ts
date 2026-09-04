/**
 * Map NFL.com roster status codes to RankEyeQ season-player fields.
 *
 * Source codes follow NFL.com / nflverse roster status conventions:
 * - ACT  — active 53-man roster
 * - DEV  — practice squad (developmental)
 * - RES / RSR / PRAC — reserve / practice-squad variants
 * - CUT / RLS / FA / UFA / … — not on this team's active roster
 * - EXE — commissioner's exempt list (still roster-affiliated; weekly field
 *         eligibility is decided separately in eligibility-rules)
 * - RSN — non-football injury reserve (roster-affiliated but not active)
 *
 * Always preserve the raw `sourceNflStatus` on SeasonPlayer for auditability.
 * This mapper only sets canonical `nflStatus` + `activeOnNFLRoster`.
 */

export type MappedRosterStatus = {
  nflStatus: string;
  activeOnNFLRoster: boolean;
};

/** Codes that are not on the active NFL roster (practice squad, cuts, etc.). */
const INACTIVE_ROSTER_STATUSES = new Set([
  "CUT",
  "RLS",
  "RELEASED",
  "FA",
  "UFA",
  "RFA",
  "NWT",
  "RET",
  "RETIRED",
  "RES",
  "RSR",
  "PRAC",
  "PRA",
  "PRACTICE",
  "PRACTICE_SQUAD",
  // Developmental / practice squad (NFL.com "DEV" column).
  "DEV",
  // International Player Pathway practice-squad exempt slot.
  "E14",
  // Under contract but not on the active roster.
  "INA",
  // Released from practice squad.
  "TRC",
  "TRD",
  "TRT",
  // Non-football injury / illness reserve — not active for weekly field.
  "RSN",
]);

const PRACTICE_SQUAD_STATUSES = new Set([
  "DEV",
  "RES",
  "RSR",
  "PRAC",
  "PRA",
  "PRACTICE",
  "PRACTICE_SQUAD",
  "E14",
]);

const INJURY_OR_DISCIPLINE_STATUSES = new Set([
  "SUS",
  "SUSPENDED",
  "IR",
  "IR-R",
  "IR-LT",
  "PUP",
  "NFI",
  "NFI-A",
  "NFI-R",
  "COVID-19",
]);

export function mapNflComStatusToSeasonFields(
  sourceStatus: string,
): MappedRosterStatus {
  const raw = sourceStatus.trim().toUpperCase();
  if (!raw) {
    return { nflStatus: "ACTIVE", activeOnNFLRoster: true };
  }

  if (raw === "ACT" || raw === "ACTIVE") {
    return { nflStatus: "ACTIVE", activeOnNFLRoster: true };
  }

  if (INACTIVE_ROSTER_STATUSES.has(raw)) {
    if (PRACTICE_SQUAD_STATUSES.has(raw)) {
      return { nflStatus: "PRACTICE_SQUAD", activeOnNFLRoster: false };
    }
    if (raw === "FA" || raw === "UFA" || raw === "RFA") {
      return { nflStatus: "FA", activeOnNFLRoster: false };
    }
    if (raw === "RET" || raw === "RETIRED") {
      return { nflStatus: "RETIRED", activeOnNFLRoster: false };
    }
    if (raw === "RSN") {
      return { nflStatus: "RSN", activeOnNFLRoster: false };
    }
    if (raw === "INA") {
      return { nflStatus: "INACTIVE", activeOnNFLRoster: false };
    }
    return { nflStatus: raw, activeOnNFLRoster: false };
  }

  if (raw === "SUS" || raw === "SUSPENDED") {
    return { nflStatus: "SUSPENDED", activeOnNFLRoster: true };
  }

  // Commissioner's exempt — still roster-affiliated; weekly inclusion is gated
  // by eligibility-rules (currently allowed unless listed as ineligible).
  if (raw === "EXE") {
    return { nflStatus: "EXE", activeOnNFLRoster: true };
  }

  if (INJURY_OR_DISCIPLINE_STATUSES.has(raw) || raw.startsWith("IR")) {
    return { nflStatus: raw, activeOnNFLRoster: true };
  }

  // Unknown codes: preserve on roster affiliation but flag for review.
  return { nflStatus: raw, activeOnNFLRoster: true };
}
