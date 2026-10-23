import { isProductionWeeklyPoolIdentity } from "@/lib/nfl/pool-source";

/**
 * Explicit synthetic / fixture bootstrap externalId patterns used in
 * integration tests and leaked into Production contest entries.
 * Maintain this denylist — do not delete RankableEntry rows for cleanup.
 */
const SYNTHETIC_BOOTSTRAP_EXTERNAL_ID_PREFIXES = [
  "dup-test-",
  "test-player-",
] as const;

/**
 * True when an nflcom-bootstrap (or other) externalId is a known test/fixture
 * artifact that must never appear on public player listings or profiles.
 */
export function isSyntheticBootstrapExternalId(externalId: string): boolean {
  const id = externalId.trim().toLowerCase();
  if (!id) return false;
  if (id.includes("-merge-")) return true;
  return SYNTHETIC_BOOTSTRAP_EXTERNAL_ID_PREFIXES.some((prefix) =>
    id.startsWith(prefix),
  );
}

export type PublicPlayerListingIdentity = {
  provider: string;
  externalId: string;
  position: string;
  type: string;
  team: string;
  active: boolean;
};

/**
 * Read-time gate for public `/players` listings and player detail pages.
 * Requires a production weekly-pool identity and excludes synthetic bootstrap
 * fixture slugs (e.g. dup-test-*, test-player-*, *-merge-*).
 */
export function shouldIncludeInPublicPlayerListings(
  entry: PublicPlayerListingIdentity,
): boolean {
  if (isSyntheticBootstrapExternalId(entry.externalId)) return false;
  return isProductionWeeklyPoolIdentity(entry);
}
