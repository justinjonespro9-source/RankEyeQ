/**
 * Map NFL.com roster status codes to RankEyeQ season-player fields.
 */

export type MappedRosterStatus = {
  nflStatus: string;
  activeOnNFLRoster: boolean;
};

const INACTIVE_ROSTER_STATUSES = new Set([
  "CUT",
  "RLS",
  "RELEASED",
  "FA",
  "RES",
  "RSR",
  "PRAC",
  "PRA",
  "PRACTICE",
  "PRACTICE_SQUAD",
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
    if (raw === "RES" || raw === "RSR" || raw === "PRAC" || raw === "PRA") {
      return { nflStatus: "PRACTICE_SQUAD", activeOnNFLRoster: false };
    }
    if (raw === "FA") {
      return { nflStatus: "FA", activeOnNFLRoster: false };
    }
    return { nflStatus: raw, activeOnNFLRoster: false };
  }

  if (raw === "SUS" || raw === "SUSPENDED") {
    return { nflStatus: "SUSPENDED", activeOnNFLRoster: true };
  }

  if (INJURY_OR_DISCIPLINE_STATUSES.has(raw) || raw.startsWith("IR")) {
    return { nflStatus: raw, activeOnNFLRoster: true };
  }

  // Unknown codes: preserve on roster affiliation but flag for review.
  return { nflStatus: raw, activeOnNFLRoster: true };
}
