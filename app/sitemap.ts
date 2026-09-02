import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.AUTH_URL?.replace(/\/$/, "") ?? "";
  const staticRoutes = [
    "",
    "/how-it-works",
    "/consensus",
    "/results",
    "/leaderboards",
    "/rankers",
    "/receipts",
    "/rank",
    "/rank/qb",
    "/rank/rb",
    "/rank/wr",
    "/rank/te",
    "/rank/def",
  ].map((path) => ({
    url: `${base}${path || "/"}`,
    changeFrequency: "daily" as const,
    priority: path === "" ? 1 : 0.7,
  }));

  if (!base) return staticRoutes;

  const profiles = await prisma.universalProfile.findMany({
    where: { status: "ACTIVE" },
    select: { username: true, updatedAt: true },
    take: 500,
    orderBy: { updatedAt: "desc" },
  });

  return [
    ...staticRoutes,
    ...profiles.map((profile) => ({
      url: `${base}/profile/${profile.username}`,
      lastModified: profile.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
