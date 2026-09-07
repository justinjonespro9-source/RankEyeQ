import type { PlacementKey, SponsorCampaign, SponsorType } from "@/lib/sponsors/types";
import {
  getHandicapHeroUrl,
  getStadiumSlopUrl,
  getTeamM8tesUrl,
} from "@/lib/sponsors/urls";

/** Visible labels — house ads never say “Sponsored”. */
export function sponsorLabelText(input: {
  sponsorType: SponsorType;
  sponsorName: string;
  houseAttribution?: "from_sng_labs" | "sng_labs_product";
}): string {
  if (input.sponsorType === "HOUSE") {
    return input.houseAttribution === "sng_labs_product"
      ? "An SNG LABS product"
      : "From SNG LABS";
  }
  return `Sponsored · Presented by ${input.sponsorName}`;
}

export function presentedByLabel(sponsorName: string): string {
  return `Presented by ${sponsorName}`;
}

/**
 * Deterministic placement → house campaign rotation.
 * Each surface features a different SNG product; same placement always resolves the same campaign.
 */
export const HOUSE_PLACEMENT_ROTATION: Record<
  PlacementKey,
  "handicap-hero" | "stadium-slop" | "team-m8tes"
> = {
  home_primary: "handicap-hero",
  rank_sidebar: "stadium-slop",
  consensus_inline: "team-m8tes",
  leaderboard_inline: "handicap-hero",
  player_performance_inline: "stadium-slop",
  profile_footer: "team-m8tes",
};

/** Future paid overrides by placement (empty for launch). */
export const PAID_PLACEMENT_OVERRIDES: Partial<
  Record<PlacementKey, string>
> = {};

export function buildHouseCampaigns(): SponsorCampaign[] {
  return [
    {
      id: "handicap-hero",
      sponsorName: "Handicap Hero",
      sponsorType: "HOUSE",
      headline: "Rank your confidence. See how deep your card survives.",
      body: "Build a ranked ATS / totals card and prove which picks you trust most.",
      ctaLabel: "Play Handicap Hero",
      destinationUrl: getHandicapHeroUrl(),
      trackingSlug: "hh-house-v1",
      accessibilityLabel: "Handicap Hero — an SNG LABS product",
      houseAttribution: "sng_labs_product",
      accentColor: "#0c7a84",
    },
    {
      id: "stadium-slop",
      sponsorName: "Stadium Slop",
      sponsorType: "HOUSE",
      headline: "Find the best food in the building.",
      body: "Fan-powered ratings and leaderboards for food and drink at stadiums and events.",
      ctaLabel: "Explore Stadium Slop",
      destinationUrl: getStadiumSlopUrl(),
      trackingSlug: "ss-house-v1",
      accessibilityLabel: "Stadium Slop — from SNG LABS",
      houseAttribution: "from_sng_labs",
      accentColor: "#c45c26",
    },
    {
      id: "team-m8tes",
      sponsorName: "Team-M8tes",
      sponsorType: "HOUSE",
      headline: "Meet people through the teams you already care about.",
      body: "Sports-fandom social matching built around shared teams and live sports interests.",
      ctaLabel: "Explore Team-M8tes",
      destinationUrl: getTeamM8tesUrl(),
      trackingSlug: "tm-house-v1",
      accessibilityLabel: "Team-M8tes — from SNG LABS",
      houseAttribution: "from_sng_labs",
      accentColor: "#1a4d7c",
    },
  ];
}

export function getCampaignById(
  id: string,
  campaigns = buildHouseCampaigns(),
): SponsorCampaign | null {
  return campaigns.find((campaign) => campaign.id === id) ?? null;
}

export function isCampaignActive(
  campaign: SponsorCampaign,
  now = new Date(),
): boolean {
  if (campaign.activeFrom) {
    const from = new Date(campaign.activeFrom);
    if (!Number.isNaN(from.getTime()) && now < from) return false;
  }
  if (campaign.activeTo) {
    const to = new Date(campaign.activeTo);
    if (!Number.isNaN(to.getTime()) && now > to) return false;
  }
  return true;
}
