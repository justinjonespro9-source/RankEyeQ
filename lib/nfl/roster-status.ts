/**
 * Map NFL.com roster status codes to RankEyeQ season-player fields.
 *
 * Source codes follow NFL.com team roster Status column:
 * - ACT  — active 53-man roster
 * - RES / RSR — Reserve/Injured (NOT practice squad)
 * - DEV / PRAC / E14 — practice squad / developmental
 * - IR / PUP / NFI* — injury reserve variants
 * - CUT / RLS / FA / UFA / … — not on this team's active roster
 * - EXE — commissioner's exempt list
 * - RSN — non-football injury / illness reserve
 * - SUS — suspended
 *
 * Always preserve the raw `sourceNflStatus` on SeasonPlayer for auditability.
 * This mapper only sets canonical `nflStatus` + `activeOnNFLRoster`.
 */

export type MappedRosterStatus = {
  nflStatus: string;
  activeOnNFLRoster: boolean;
};

/** Codes that are not on the active participating NFL roster. */
const OFF_ACTIVE_ROSTER_STATUSES = new Set([
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
  "DEV",
  "E14",
  "INA",
  "TRC",
  "TRD",
  "TRT",
  "RSN",
  "EXE",
  "IR",
  "IR-R",
  "IR-LT",
  "PUP",
  "NFI",
  "NFI-A",
  "NFI-R",
]);

/** Practice-squad / developmental only — never Reserve/Injured. */
const PRACTICE_SQUAD_STATUSES = new Set([
  "DEV",
  "PRAC",
  "PRA",
  "PRACTICE",
  "PRACTICE_SQUAD",
  "E14",
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

  if (raw === "SUS" || raw === "SUSPENDED") {
    // Still roster-affiliated; hard-unavailable for weekly selection via resolver.
    return { nflStatus: "SUSPENDED", activeOnNFLRoster: true };
  }

  // Reserve/Injured — NFL.com uses RES/RSR on team roster pages.
  if (raw === "RES" || raw === "RSR" || raw === "RESERVE_INJURED") {
    return { nflStatus: "IR", activeOnNFLRoster: false };
  }

  if (raw.startsWith("IR")) {
    return { nflStatus: raw === "IR" ? "IR" : raw, activeOnNFLRoster: false };
  }

  if (raw === "PUP" || raw.startsWith("PUP")) {
    return { nflStatus: "PUP", activeOnNFLRoster: false };
  }

  if (raw.startsWith("NFI") || raw === "RSN") {
    // NFI / non-football reserve → canonical IR for availability; keep RSN distinct.
    if (raw === "RSN") {
      return { nflStatus: "RSN", activeOnNFLRoster: false };
    }
    return { nflStatus: raw, activeOnNFLRoster: false };
  }

  if (raw === "EXE") {
    return { nflStatus: "EXE", activeOnNFLRoster: false };
  }

  if (PRACTICE_SQUAD_STATUSES.has(raw)) {
    return { nflStatus: "PRACTICE_SQUAD", activeOnNFLRoster: false };
  }

  if (raw === "FA" || raw === "UFA" || raw === "RFA") {
    return { nflStatus: "FA", activeOnNFLRoster: false };
  }
  if (raw === "RET" || raw === "RETIRED") {
    return { nflStatus: "RETIRED", activeOnNFLRoster: false };
  }
  if (raw === "INA") {
    return { nflStatus: "INACTIVE", activeOnNFLRoster: false };
  }
  if (raw === "CUT" || raw === "RLS" || raw === "RELEASED") {
    return { nflStatus: "CUT", activeOnNFLRoster: false };
  }

  if (OFF_ACTIVE_ROSTER_STATUSES.has(raw)) {
    return { nflStatus: raw, activeOnNFLRoster: false };
  }

  // Unknown codes: preserve but do not assume active participation.
  return { nflStatus: raw, activeOnNFLRoster: true };
}
