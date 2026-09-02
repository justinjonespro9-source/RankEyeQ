import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";
import { isCanonicalDefenseRankableEntry } from "@/lib/nfl/defense-identity";

const LEGACY_TEST_PROVIDERS = new Set(["mock"]);

export function isLegacyTestPoolProvider(provider: string): boolean {
  return LEGACY_TEST_PROVIDERS.has(provider);
}

export function isLegacyManualDefenseExternalId(externalId: string): boolean {
  return externalId.startsWith("manual-def-") || externalId.startsWith("mock-def-");
}

/**
 * Whether a rankable identity should participate in a real production-season weekly pool.
 * NFL.com bootstrap is canonical for players; defenses must use def-{TEAM} external IDs.
 */
export function isProductionWeeklyPoolIdentity(input: {
  provider: string;
  externalId: string;
  position: string;
  type: string;
  team: string;
  active: boolean;
}): boolean {
  if (!input.active) return false;
  if (isLegacyTestPoolProvider(input.provider)) return false;

  if (input.position === "DEF") {
    if (input.provider === "manual" && isLegacyManualDefenseExternalId(input.externalId)) {
      return false;
    }
    return isCanonicalDefenseRankableEntry({
      position: "DEF",
      type: input.type,
      provider: input.provider,
      externalId: input.externalId,
      team: input.team,
    });
  }

  if (input.provider === NFL_COM_BOOTSTRAP_PROVIDER) return true;

  // Legacy manual offensive identities are not part of production weekly pools.
  if (input.provider === "manual" && input.type === "PLAYER") {
    return false;
  }

  if (input.provider === "manual" && input.externalId.startsWith("manual-def-")) {
    return false;
  }

  return false;
}
