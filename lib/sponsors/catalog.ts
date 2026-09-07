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

/** Public asset paths for HOUSE creatives (copied from SNG product repos). */
export const HOUSE_ASSET_PATHS = {
  handicapHero: {
    mark: "/sponsors/handicap-hero/hh-mark-gold.svg",
    wordmark: "/sponsors/handicap-hero/wordmark.png",
  },
  stadiumSlop: {
    wordmark: "/sponsors/stadium-slop/wordmark.png",
    icon: "/sponsors/stadium-slop/icon.png",
    heroBg: "/sponsors/stadium-slop/hero-bg.png",
    foodCreative: "/sponsors/stadium-slop/food-creative.png",
  },
  teamM8tes: {
    logo: "/sponsors/team-m8tes/logo.png",
    wordmark: "/sponsors/team-m8tes/wordmark.svg",
    fandomFilter: "/sponsors/team-m8tes/fandom-filter.png",
  },
} as const;

export function buildHouseCampaigns(): SponsorCampaign[] {
  return [
    {
      id: "handicap-hero",
      sponsorName: "Handicap Hero",
      sponsorType: "HOUSE",
      theme: "handicap-hero",
      themeClassName: "sponsor-theme-hh",
      headline: "Prove It.",
      subheadline: "The Free Verified Handicapping Market",
      body: "Build a confidence-ranked parlay survival card. Rank your picks, survive as many legs as you can, and climb verified worldwide leaderboards.",
      ctaLabel: "Play Handicap Hero",
      destinationUrl: getHandicapHeroUrl(),
      trackingSlug: "hh-house-v1",
      accessibilityLabel: "Handicap Hero — an SNG LABS product",
      houseAttribution: "sng_labs_product",
      logoUrl: HOUSE_ASSET_PATHS.handicapHero.mark,
      logoAlt: "Handicap Hero",
      imageUrl: HOUSE_ASSET_PATHS.handicapHero.wordmark,
      accentColor: "#f8c94a",
      textTone: "light",
      ctaClassName:
        "rounded-md border border-[#f8c94a]/50 bg-[#f8c94a] px-4 py-2 text-sm font-bold text-black hover:bg-[#ffd76a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f8c94a]",
    },
    {
      id: "stadium-slop",
      sponsorName: "Stadium Slop",
      sponsorType: "HOUSE",
      theme: "stadium-slop",
      themeClassName: "sponsor-theme-ss",
      headline: "Know the score before you order.",
      body: "Crowd-powered food rankings for stadiums, fairs, and live-event venues.",
      ctaLabel: "Explore Stadium Slop",
      destinationUrl: getStadiumSlopUrl(),
      trackingSlug: "ss-house-v1",
      accessibilityLabel: "Stadium Slop — from SNG LABS",
      houseAttribution: "from_sng_labs",
      logoUrl: HOUSE_ASSET_PATHS.stadiumSlop.wordmark,
      logoAlt: "Stadium Slop",
      backgroundImageUrl: HOUSE_ASSET_PATHS.stadiumSlop.heroBg,
      imageUrl: HOUSE_ASSET_PATHS.stadiumSlop.foodCreative,
      accentColor: "#ff6b1a",
      textTone: "light",
      imageObjectPosition: "72% center",
      imageObjectPositionMobile: "center 30%",
      ctaClassName:
        "rounded-md border border-[#ff6b1a]/40 bg-[#ff6b1a] px-4 py-2 text-sm font-bold text-white hover:bg-[#ff8533] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6b1a]",
    },
    {
      id: "team-m8tes",
      sponsorName: "Team-M8tes",
      sponsorType: "HOUSE",
      theme: "team-m8tes",
      themeClassName: "sponsor-theme-tm",
      headline: "Fandom is the filter.",
      body: "Meet sports fans who already speak your language.",
      ctaLabel: "Join Team-M8tes",
      destinationUrl: getTeamM8tesUrl(),
      trackingSlug: "tm-house-v1",
      accessibilityLabel: "Team-M8tes — from SNG LABS",
      houseAttribution: "from_sng_labs",
      logoUrl: HOUSE_ASSET_PATHS.teamM8tes.logo,
      logoAlt: "Team-M8tes",
      backgroundImageUrl: HOUSE_ASSET_PATHS.teamM8tes.fandomFilter,
      accentColor: "#db2777",
      textTone: "light",
      imageObjectPosition: "88% center",
      imageObjectPositionMobile: "78% 28%",
      ctaClassName:
        "rounded-full border border-white/20 bg-gradient-to-br from-purple-600 via-pink-600 to-pink-400 px-5 py-2.5 text-sm font-extrabold text-white shadow-sm hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-300",
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

/** Whether the campaign uses a product-branded HOUSE shell (vs RankEyeQ-native paid shell). */
export function usesProductHouseTheme(campaign: SponsorCampaign): boolean {
  return (
    campaign.sponsorType === "HOUSE" &&
    Boolean(campaign.theme) &&
    campaign.theme !== "generic"
  );
}
