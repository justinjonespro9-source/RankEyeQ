import type { MetadataRoute } from "next";
import {
  buildRobotsRules,
  getCanonicalSiteOrigin,
} from "@/lib/seo";

/**
 * Crawl guidance for public discovery. Not an access-control mechanism —
 * auth, admin guards, and Vercel Firewall remain the security layers.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = getCanonicalSiteOrigin();
  const built = buildRobotsRules(origin);
  return {
    rules: built.rules,
    sitemap: built.sitemap,
    host: built.host,
  };
}
