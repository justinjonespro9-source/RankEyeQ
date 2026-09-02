/**
 * NFL roster/status rules for weekly contest-field inclusion.
 * Editorial relevance must not gate eligibility — only data-integrity exclusions.
 */

/** Statuses that remove a player from the weekly ranking field. */
export const INELIGIBLE_NFL_STATUSES = new Set([
  "SUSPENDED",
  "PUP",
  "NFI",
  "NFI-A",
  "NFI-R",
  "IR",
  "IR-R",
  "IR-LT",
  "COVID-19",
  "RETIRED",
  "FA", // not on an eligible roster
]);

export function isSeasonPlayerEligibleForWeeklyField(input: {
  activeOnNFLRoster: boolean;
  nflStatus: string;
}): boolean {
  if (!input.activeOnNFLRoster) return false;
  const status = input.nflStatus.trim().toUpperCase();
  if (!status || status === "ACTIVE") return true;
  return !INELIGIBLE_NFL_STATUSES.has(status);
}

/** True when an admin exclusion should be preserved across pool syncs. */
export function shouldPreserveAdminExclusion(entry: {
  excluded: boolean;
  manuallyAdded: boolean;
  inactiveReason: string | null;
}): boolean {
  if (!entry.excluded) return false;
  if (entry.manuallyAdded) return true;
  if (entry.inactiveReason?.trim()) return true;
  return false;
}
