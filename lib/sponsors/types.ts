/** Sponsor / house-ad placement types (V1 — code catalog, no DB). */

export type SponsorType = "HOUSE" | "PAID";

export type PlacementKey =
  | "home_primary"
  | "rank_sidebar"
  | "consensus_inline"
  | "leaderboard_inline"
  | "player_performance_inline"
  | "profile_footer";

export const PLACEMENT_KEYS: readonly PlacementKey[] = [
  "home_primary",
  "rank_sidebar",
  "consensus_inline",
  "leaderboard_inline",
  "player_performance_inline",
  "profile_footer",
] as const;

export type SponsorCampaignId =
  | "handicap-hero"
  | "stadium-slop"
  | "team-m8tes";

/** Product creative themes for HOUSE ads. PAID stays on the generic RankEyeQ shell. */
export type HouseCreativeTheme =
  | "handicap-hero"
  | "stadium-slop"
  | "team-m8tes"
  | "generic";

export type SponsorCampaign = {
  id: SponsorCampaignId | string;
  sponsorName: string;
  sponsorType: SponsorType;
  headline: string;
  /** Optional product subhead (HOUSE creatives). */
  subheadline?: string | null;
  body: string;
  ctaLabel: string;
  /** Resolved absolute URL (env-aware). */
  destinationUrl: string;
  trackingSlug: string;
  accessibilityLabel: string;
  /** House ads: SNG LABS ecosystem attribution. */
  houseAttribution?: "from_sng_labs" | "sng_labs_product";
  logoUrl?: string | null;
  logoAlt?: string | null;
  imageUrl?: string | null;
  backgroundImageUrl?: string | null;
  activeFrom?: string | null;
  activeTo?: string | null;
  /** Optional product accent token for the mark (CSS color). */
  accentColor?: string;
  /** HOUSE product theme — drives branded card chrome. */
  theme?: HouseCreativeTheme;
  /** Extra class on the card shell (HOUSE only). */
  themeClassName?: string;
  /** CTA button classes (HOUSE product CTAs). */
  ctaClassName?: string;
  textTone?: "light" | "dark";
  /** Desktop creative crop (object-position). */
  imageObjectPosition?: string;
  /** Mobile creative crop. */
  imageObjectPositionMobile?: string;
};

export type ResolvedPlacement = {
  placementKey: PlacementKey;
  campaign: SponsorCampaign;
  /** Visible label line (house vs paid). */
  labelText: string;
  /** Click path that preserves placement + campaign for analytics. */
  trackedHref: string;
};
