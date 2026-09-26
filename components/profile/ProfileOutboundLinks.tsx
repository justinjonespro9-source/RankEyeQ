"use client";

import { trackClientEvent } from "@/lib/analytics";
import {
  destinationHostFromUrl,
  type PublicSocialLink,
} from "@/lib/profile-links";

export function ProfileSocialLinks({
  profileId,
  links,
}: {
  profileId: string;
  links: PublicSocialLink[];
}) {
  if (links.length === 0) return null;

  return (
    <ul className="mt-4 flex flex-wrap gap-2" aria-label="Social and content links">
      {links.map((link) => (
        <li key={link.kind}>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink hover:border-ink/30"
            onClick={() => {
              trackClientEvent("outbound_link_clicked", {
                profileId,
                linkKind: link.kind,
                destinationHost: destinationHostFromUrl(link.url),
              });
            }}
          >
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function ProfileFeaturedContent({
  profileId,
  title,
  url,
}: {
  profileId: string;
  title: string;
  url: string;
}) {
  return (
    <aside className="mt-5 rounded-lg border border-accent/25 bg-accent-soft/30 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-ink">
        Featured
      </p>
      <p className="mt-1 text-sm font-medium text-ink">{title}</p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex text-sm font-medium text-accent-ink hover:underline"
        onClick={() => {
          trackClientEvent("outbound_link_clicked", {
            profileId,
            linkKind: "featured",
            destinationHost: destinationHostFromUrl(url),
          });
        }}
      >
        Visit →
      </a>
    </aside>
  );
}
