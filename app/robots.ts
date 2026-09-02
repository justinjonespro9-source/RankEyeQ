import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.AUTH_URL?.replace(/\/$/, "") ?? "";
  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/how-it-works",
          "/consensus",
          "/results",
          "/leaderboards",
          "/rankers",
          "/receipts",
        ],
        disallow: [
          "/account",
          "/account/setup",
          "/creator",
          "/following",
          "/admin",
          "/signin",
          "/rank",
          "/api/",
        ],
      },
    ],
    sitemap: base ? `${base}/sitemap.xml` : undefined,
  };
}
