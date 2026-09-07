import type { MetadataRoute } from "next";
import { unstable_cache } from "next/cache";
import {
  SITEMAP_STATIC_PATHS,
  absoluteUrl,
  getCanonicalSiteOrigin,
  isSitemapExcludedPath,
} from "@/lib/seo";
import { loadDynamicSitemapEntries } from "@/lib/sitemap-data";

const SITEMAP_REVALIDATE_SECONDS = 3600;

const getCachedDynamicSitemapEntries = unstable_cache(
  loadDynamicSitemapEntries,
  // Bump when selection rules change so production does not serve a stale empty set.
  ["rankeyeq-public-sitemap-v3"],
  { revalidate: SITEMAP_REVALIDATE_SECONDS },
);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
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
    return staticRoutes;
  }
}
