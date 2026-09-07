import type { MetadataRoute } from "next";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import {
  SITEMAP_STATIC_PATHS,
  absoluteUrl,
  getCanonicalSiteOrigin,
  isSitemapExcludedPath,
} from "@/lib/seo";

const PROFILE_SITEMAP_LIMIT = 300;
const PLAYER_SITEMAP_LIMIT = 200;
const SITEMAP_REVALIDATE_SECONDS = 3600;

async function loadDynamicSitemapEntries(): Promise<MetadataRoute.Sitemap> {
  const [profiles, players] = await Promise.all([
    prisma.universalProfile.findMany({
      where: {
        status: "ACTIVE",
        publicVisible: true,
      },
      select: { username: true, updatedAt: true, profileType: true },
      take: PROFILE_SITEMAP_LIMIT,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.rankableEntry.findMany({
      where: {
        OR: [
          { playerWeekStats: { some: {} } },
          { defenseWeekStats: { some: {} } },
        ],
      },
      select: {
        id: true,
        externalId: true,
        updatedAt: true,
      },
      take: PLAYER_SITEMAP_LIMIT,
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const profileEntries: MetadataRoute.Sitemap = profiles
    .map((profile) => ({
      url: absoluteUrl(`/profile/${profile.username}`),
      lastModified: profile.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.55,
    }))
    .filter((entry) => !isSitemapExcludedPath(new URL(entry.url).pathname));

  const playerEntries: MetadataRoute.Sitemap = players.map((player) => {
    const pathId = player.externalId?.trim() || player.id;
    return {
      url: absoluteUrl(`/players/${encodeURIComponent(pathId)}`),
      lastModified: player.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    };
  });

  return [...profileEntries, ...playerEntries];
}

const getCachedDynamicSitemapEntries = unstable_cache(
  loadDynamicSitemapEntries,
  ["rankeyeq-public-sitemap-v1"],
  { revalidate: SITEMAP_REVALIDATE_SECONDS },
);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Ensure origin helpers resolve (and keep sitemap host stable in prod).
  void getCanonicalSiteOrigin();

  const staticRoutes: MetadataRoute.Sitemap = SITEMAP_STATIC_PATHS.filter(
    (path) => !isSitemapExcludedPath(path),
  ).map((path) => ({
    url: absoluteUrl(path),
    changeFrequency: path === "/" ? ("daily" as const) : ("weekly" as const),
    priority: path === "/" ? 1 : path === "/how-it-works" ? 0.85 : 0.7,
  }));

  try {
    const dynamicRoutes = await getCachedDynamicSitemapEntries();
    return [...staticRoutes, ...dynamicRoutes];
  } catch {
    // Fail open with static public URLs only — never block deploy on DB blips.
    return staticRoutes;
  }
}
