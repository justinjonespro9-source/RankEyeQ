export type {
  PlacementKey,
  ResolvedPlacement,
  SponsorCampaign,
  SponsorCampaignId,
  SponsorType,
} from "@/lib/sponsors/types";
export { PLACEMENT_KEYS } from "@/lib/sponsors/types";
export {
  buildHouseCampaigns,
  getCampaignById,
  HOUSE_PLACEMENT_ROTATION,
  isCampaignActive,
  PAID_PLACEMENT_OVERRIDES,
  presentedByLabel,
  sponsorLabelText,
} from "@/lib/sponsors/catalog";
export {
  buildTrackedHref,
  resolveAllPlacements,
  resolvePlacement,
} from "@/lib/sponsors/resolve";
export {
  getAllowedSponsorDestinations,
  getHandicapHeroUrl,
  getStadiumSlopUrl,
  getTeamM8tesUrl,
  isAllowedSponsorDestination,
} from "@/lib/sponsors/urls";
