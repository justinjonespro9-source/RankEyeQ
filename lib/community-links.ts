/**
 * Canonical public RankEyeQ social / community destinations.
 * Keep UI, JSON-LD, and docs in sync via this module — do not hardcode elsewhere.
 */

export type CommunityLinkId = "x" | "tiktok" | "instagram" | "discord";

export type CommunityLink = {
  id: CommunityLinkId;
  /** Short visible / accessible label (platform name). */
  label: string;
  href: string;
  /**
   * Richer accessible name for screen readers / title.
   * Discord is framed as community, not only a profile.
   */
  ariaLabel: string;
};

export const COMMUNITY_LINKS: readonly CommunityLink[] = [
  {
    id: "x",
    label: "X",
    href: "https://x.com/RankEyeQ",
    ariaLabel: "RankEyeQ on X",
  },
  {
    id: "tiktok",
    label: "TikTok",
    href: "https://www.tiktok.com/@rankeyeq?lang=en",
    ariaLabel: "RankEyeQ on TikTok",
  },
  {
    id: "instagram",
    label: "Instagram",
    href: "https://www.instagram.com/rankeyeq/",
    ariaLabel: "RankEyeQ on Instagram",
  },
  {
    id: "discord",
    label: "Discord",
    href: "https://discord.gg/tqCK4uRq4",
    ariaLabel: "Join the RankEyeQ community on Discord",
  },
] as const;

/** URLs for Organization `sameAs` / link audits. */
export function communityLinkHrefs(): string[] {
  return COMMUNITY_LINKS.map((link) => link.href);
}
