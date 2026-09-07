import {
  buildHouseCampaigns,
  getCampaignById,
  HOUSE_PLACEMENT_ROTATION,
  isCampaignActive,
  PAID_PLACEMENT_OVERRIDES,
  sponsorLabelText,
} from "@/lib/sponsors/catalog";
import type {
  PlacementKey,
  ResolvedPlacement,
  SponsorCampaign,
} from "@/lib/sponsors/types";
import { PLACEMENT_KEYS } from "@/lib/sponsors/types";

export function buildTrackedHref(input: {
  placementKey: PlacementKey;
  campaign: SponsorCampaign;
}): string {
  const params = new URLSearchParams({
    p: input.placementKey,
    c: input.campaign.trackingSlug,
    id: String(input.campaign.id),
    u: input.campaign.destinationUrl,
  });
  return `/go?${params.toString()}`;
}

/**
 * Resolve one creative for a placement.
 * Paid override wins when present and active; otherwise house rotation.
 */
export function resolvePlacement(
  placementKey: PlacementKey,
  options?: {
    now?: Date;
    campaigns?: SponsorCampaign[];
    paidOverrides?: Partial<Record<PlacementKey, string>>;
  },
): ResolvedPlacement | null {
  if (!PLACEMENT_KEYS.includes(placementKey)) return null;

  const now = options?.now ?? new Date();
  const campaigns = options?.campaigns ?? buildHouseCampaigns();
  const paidOverrides = options?.paidOverrides ?? PAID_PLACEMENT_OVERRIDES;

  const paidId = paidOverrides[placementKey];
  if (paidId) {
    const paid = getCampaignById(paidId, campaigns);
    if (paid && paid.sponsorType === "PAID" && isCampaignActive(paid, now)) {
      return {
        placementKey,
        campaign: paid,
        labelText: sponsorLabelText(paid),
        trackedHref: buildTrackedHref({ placementKey, campaign: paid }),
      };
    }
  }

  const houseId = HOUSE_PLACEMENT_ROTATION[placementKey];
  const house = getCampaignById(houseId, campaigns);
  if (!house || !isCampaignActive(house, now)) return null;

  return {
    placementKey,
    campaign: house,
    labelText: sponsorLabelText(house),
    trackedHref: buildTrackedHref({ placementKey, campaign: house }),
  };
}

export function resolveAllPlacements(now = new Date()) {
  return PLACEMENT_KEYS.map((key) => resolvePlacement(key, { now })).filter(
    (row): row is ResolvedPlacement => row != null,
  );
}
