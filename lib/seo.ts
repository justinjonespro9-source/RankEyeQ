import type { Metadata } from "next";
import { PUBLIC_BRAND_NAME } from "@/lib/brand";

/** Production canonical host (always www). */
export const CANONICAL_SITE_HOST = "www.rankeyeq.com";
export const CANONICAL_SITE_ORIGIN = `https://${CANONICAL_SITE_HOST}`;

export const NO_INDEX: Pick<Metadata, "robots"> = {
  robots: { index: false, follow: false },
};

export const PUBLIC_INDEX: Pick<Metadata, "robots"> = {
  robots: { index: true, follow: true },
};

/**
 * Resolve the public origin used for canonical URLs and the sitemap.
 * Prefer NEXT_PUBLIC_SITE_URL, then AUTH_URL, then production www default.
 * Bare rankeyeq.com is normalized to www.rankeyeq.com.
 */
export function getCanonicalSiteOrigin(): string {
  const raw = (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.AUTH_URL?.trim() ||
    CANONICAL_SITE_ORIGIN
  ).replace(/\/$/, "");

  try {
    const url = new URL(raw);
    if (url.hostname === "rankeyeq.com") {
      url.hostname = CANONICAL_SITE_HOST;
    }
    return url.origin;
  } catch {
    return CANONICAL_SITE_ORIGIN;
  }
}

export function absoluteUrl(path = "/"): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized === "/") return `${getCanonicalSiteOrigin()}/`;
  return `${getCanonicalSiteOrigin()}${normalized.replace(/\/$/, "")}`;
}

/** Strip query/hash and normalize path for canonical tags. */
export function canonicalizePath(path: string): string {
  const withoutQuery = path.split("?")[0]?.split("#")[0] ?? "/";
  if (!withoutQuery || withoutQuery === "/") return "/";
  const withSlash = withoutQuery.startsWith("/")
    ? withoutQuery
    : `/${withoutQuery}`;
  return withSlash.replace(/\/+$/, "") || "/";
}

/** Lowercase position segment for /rank/{position} canonicals. */
export function rankPositionCanonicalPath(position: string): string {
  return `/rank/${position.trim().toLowerCase()}`;
}

export function canonicalMetadata(
  path: string,
): Pick<Metadata, "alternates"> {
  const clean = canonicalizePath(path);
  return {
    alternates: {
      canonical: absoluteUrl(clean),
    },
  };
}

export function privatePageMetadata(
  title: string,
  description: string,
): Metadata {
  return {
    title,
    description,
    ...NO_INDEX,
  };
}

export function publicPageMetadata(input: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const canonical = canonicalizePath(input.path);
  return {
    title: input.title,
    description: input.description,
    ...PUBLIC_INDEX,
    ...canonicalMetadata(canonical),
    openGraph: {
      type: "website",
      siteName: PUBLIC_BRAND_NAME,
      url: absoluteUrl(canonical),
      title: input.title,
      description: input.description,
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: input.description,
    },
  };
}

/** Paths allowed for sitemap inclusion (no query variants). */
export const SITEMAP_STATIC_PATHS = [
  "/",
  "/how-it-works",
  "/how-to-play",
  "/results",
  "/leaderboards",
  "/players",
  "/rankers",
  "/consensus",
  "/receipts",
  "/archive",
  "/legal",
  "/privacy",
  "/terms",
] as const;

/**
 * robots.txt disallow paths. Guidance only — not security.
 * Use `/rank$` + `/rank/` so `/rankers` stays crawlable.
 */
export const ROBOTS_DISALLOW_PATHS = [
  "/admin",
  "/account",
  "/api/",
  "/go",
  "/signin",
  "/creator",
  "/following",
  "/rank$",
  "/rank/",
  "/leaderboards/live",
] as const;

export function buildRobotsRules(origin: string) {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"] as string[],
        disallow: [...ROBOTS_DISALLOW_PATHS],
      },
    ],
    sitemap: `${origin.replace(/\/$/, "")}/sitemap.xml`,
    host: origin.replace(/^https?:\/\//, "").replace(/\/$/, ""),
  };
}

export function isSitemapExcludedPath(path: string): boolean {
  if (path.includes("?")) return true;
  const clean = canonicalizePath(path);
  if (clean.startsWith("/admin")) return true;
  if (clean.startsWith("/account")) return true;
  if (clean.startsWith("/api")) return true;
  if (clean === "/go" || clean.startsWith("/go/")) return true;
  if (clean.startsWith("/signin")) return true;
  if (clean === "/creator" || clean.startsWith("/creator/")) return true;
  if (clean === "/following" || clean.startsWith("/following/")) return true;
  if (clean === "/rank" || clean.startsWith("/rank/")) return true;
  if (clean.startsWith("/leaderboards/live")) return true;
  return false;
}
