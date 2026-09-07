"use client";

import { trackClientEvent } from "@/lib/analytics";
import type { PlacementKey } from "@/lib/sponsors/types";

type SponsorClickLinkProps = {
  href: string;
  placementKey: PlacementKey;
  campaignId: string;
  trackingSlug: string;
  destinationUrl: string;
  className?: string;
  children: React.ReactNode;
};

/**
 * Outbound CTA: client analytics + /go redirect (server log + allowlisted destination).
 */
export function SponsorClickLink({
  href,
  placementKey,
  campaignId,
  trackingSlug,
  destinationUrl,
  className,
  children,
}: SponsorClickLinkProps) {
  return (
    <a
      href={href}
      className={className}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => {
        trackClientEvent("sponsor_click", {
          placementKey,
          campaignId,
          trackingSlug,
          destinationHost: safeHost(destinationUrl),
        });
      }}
    >
      {children}
    </a>
  );
}

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
