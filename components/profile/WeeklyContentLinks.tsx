"use client";

import { trackClientEvent } from "@/lib/analytics";
import { destinationHostFromUrl, safePublicHref } from "@/lib/profile-links";
import {
  weeklyContentTypeLabel,
  type WeeklyContentItem,
} from "@/lib/weekly-content-shared";

/** Owner-attached weekly links. Distinct from RankEyeQ capture provenance. */
export function WeeklyContentLinks({
  profileId,
  items,
}: {
  profileId: string;
  items: WeeklyContentItem[];
}) {
  const rows = items
    .map((item) => ({ ...item, href: safePublicHref(item.url) }))
    .filter((item): item is WeeklyContentItem & { href: string } =>
      Boolean(item.href),
    );
  if (rows.length === 0) return null;
  return (
    <ul className="space-y-1 text-sm">
      {rows.map((item) => (
        <li key={item.id}>
          <span className="mr-2 text-xs uppercase tracking-wide text-muted">
            {weeklyContentTypeLabel(item.type)}
          </span>
          <a
            href={item.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="font-medium text-accent-ink hover:underline"
            onClick={() => {
              trackClientEvent("outbound_link_clicked", {
                profileId,
                linkKind: "weekly_content",
                destinationHost: destinationHostFromUrl(item.href),
              });
            }}
          >
            {item.title} →
          </a>
        </li>
      ))}
    </ul>
  );
}
