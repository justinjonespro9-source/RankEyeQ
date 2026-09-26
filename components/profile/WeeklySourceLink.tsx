"use client";

import { trackClientEvent } from "@/lib/analytics";
import { destinationHostFromUrl } from "@/lib/profile-links";

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
  return (
    <p className="text-sm">
      <a
        href={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-accent-ink hover:underline"
        onClick={() => {
          trackClientEvent("outbound_link_clicked", {
            profileId,
            linkKind: "weekly_source",
            destinationHost: destinationHostFromUrl(sourceUrl),
          });
        }}
      >
        View original rankings →
      </a>
    </p>
  );
}
