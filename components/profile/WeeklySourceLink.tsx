"use client";

import { trackClientEvent } from "@/lib/analytics";
import { destinationHostFromUrl, safePublicHref } from "@/lib/profile-links";

/**
 * RankEyeQ-controlled weekly provenance deep link.
 * Distinct from owner-controlled profile social / featured links.
 */
export function WeeklySourceLink({
  profileId,
  sourceUrl,
}: {
  profileId: string;
  sourceUrl: string;
}) {
  const href = safePublicHref(sourceUrl);
  if (!href) return null;
  return (
    <p className="text-sm">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-accent-ink hover:underline"
        onClick={() => {
          trackClientEvent("outbound_link_clicked", {
            profileId,
            linkKind: "weekly_source",
            destinationHost: destinationHostFromUrl(href),
          });
        }}
      >
        View original rankings →
      </a>
    </p>
  );
}
