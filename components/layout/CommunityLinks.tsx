import type { ComponentType } from "react";
import {
  COMMUNITY_LINKS,
  type CommunityLinkId,
} from "@/lib/community-links";
import {
  DiscordIcon,
  InstagramIcon,
  TikTokIcon,
  XIcon,
} from "@/components/icons/SocialIcons";

const ICONS: Record<
  CommunityLinkId,
  ComponentType<{ className?: string }>
> = {
  x: XIcon,
  tiktok: TikTokIcon,
  instagram: InstagramIcon,
  discord: DiscordIcon,
};

type CommunityLinksProps = {
  className?: string;
  /** When true, Discord shows a “Community” label beside the icon. */
  emphasizeCommunity?: boolean;
};

export function CommunityLinks({
  className = "",
  emphasizeCommunity = true,
}: CommunityLinksProps) {
  return (
    <nav
      aria-label="RankEyeQ community and social"
      className={`flex flex-wrap items-center gap-1.5 sm:gap-2 ${className}`}
    >
      {COMMUNITY_LINKS.map((link) => {
        const Icon = ICONS[link.id];
        const isDiscord = link.id === "discord";
        const showCommunityLabel = emphasizeCommunity && isDiscord;

        return (
          <a
            key={link.id}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={link.ariaLabel}
            title={link.ariaLabel}
            className={
              showCommunityLabel
                ? "inline-flex min-h-11 min-w-11 items-center gap-1.5 rounded-md border border-border bg-surface-elevated px-3 text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent-ink"
                : "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-elevated hover:text-ink"
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {showCommunityLabel ? (
              <span>Community</span>
            ) : (
              <span className="sr-only">{link.label}</span>
            )}
          </a>
        );
      })}
    </nav>
  );
}
