/**
 * Client-safe helpers for rendering owner-controlled profile links.
 * No database access — safe to import from client components.
 */

export type PublicSocialLinkKind =
  | "website"
  | "x"
  | "youtube"
  | "instagram"
  | "tiktok"
  | "podcast";

export type PublicSocialLink = {
  kind: PublicSocialLinkKind;
  label: string;
  url: string;
};

/** Defense in depth: only render http(s) URLs even if storage were bypassed. */
export function safePublicHref(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function buildPublicSocialLinks(input: {
  websiteUrl?: string | null;
  xUrl?: string | null;
  youtubeUrl?: string | null;
  instagramUrl?: string | null;
  tiktokUrl?: string | null;
  podcastUrl?: string | null;
}): PublicSocialLink[] {
  const rows: PublicSocialLink[] = [];
  const push = (
    kind: PublicSocialLinkKind,
    label: string,
    url: string | null | undefined,
  ) => {
    const href = safePublicHref(url);
    if (!href) return;
    rows.push({ kind, label, url: href });
  };
  push("x", "X", input.xUrl);
  push("youtube", "YouTube", input.youtubeUrl);
  push("instagram", "Instagram", input.instagramUrl);
  push("tiktok", "TikTok", input.tiktokUrl);
  push("podcast", "Podcast", input.podcastUrl);
  push("website", "Website", input.websiteUrl);
  return rows;
}

/** Featured CTA renders only when both title and a safe URL exist. */
export function resolveFeaturedLink(input: {
  featuredLinkTitle?: string | null;
  featuredLinkUrl?: string | null;
}): { title: string; url: string } | null {
  const title = input.featuredLinkTitle?.trim();
  const url = safePublicHref(input.featuredLinkUrl);
  if (!title || !url) return null;
  return { title, url };
}

/** Host only — no path/query — for outbound analytics. */
export function destinationHostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
