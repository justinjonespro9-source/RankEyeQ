import type { MetadataRoute } from "next";
import { isOfficialBenchmarkUsername } from "@/lib/benchmark-sources";
import { prisma } from "@/lib/db";
import { EXPERT_SOURCE_KIND } from "@/lib/expert-identity";
import { publicPlayerPathId } from "@/lib/player-detail-queries";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";
import { absoluteUrl } from "@/lib/seo";
import type { ProfileType } from "@/lib/generated/prisma/client";

export const PROFILE_SITEMAP_LIMIT = 300;
export const PLAYER_SITEMAP_LIMIT = 200;

export type SitemapProfileCandidate = {
  username: string;
  updatedAt: Date;
  profileType: ProfileType;
  competitorActive: boolean;
  expertSourceKind: string | null;
};

/**
 * Profiles suitable for the public sitemap.
 * Excludes inactive legacy publisher shells (official BENCHMARK usernames /
 * non-ANALYST expert sources) while keeping active Humans, Creators, AI,
 * and individual Expert analysts.
 */
export function shouldIncludeProfileInSitemap(
  profile: SitemapProfileCandidate,
): boolean {
  if (!profile.username.trim()) return false;

  if (profile.profileType === "BENCHMARK") {
    if (!profile.competitorActive) return false;
    if (isOfficialBenchmarkUsername(profile.username)) return false;
    const kind = profile.expertSourceKind?.trim().toUpperCase() ?? "";
    // Competing Experts are individual analysts — not publisher shells.
    if (kind && kind !== EXPERT_SOURCE_KIND.ANALYST) return false;
    if (!kind) return false;
    return true;
  }

  if (
    profile.profileType === "HUMAN" ||
    profile.profileType === "CREATOR" ||
    profile.profileType === "AI"
  ) {
    // AI / Creator inactive roster rows stay out of the crawl set.
    if (
      (profile.profileType === "AI" || profile.profileType === "CREATOR") &&
      !profile.competitorActive
    ) {
      return false;
    }
    return true;
  }

  return false;
}

export type SitemapPlayerCandidate = {
  id: string;
  provider: string;
  externalId: string;
  updatedAt: Date;
  type: "PLAYER" | "DEFENSE" | string;
  active: boolean;
};

/** Canonical player/DEF path ids for sitemap (deduped, bounded). */
export function buildPlayerSitemapEntries(
  players: SitemapPlayerCandidate[],
  limit = PLAYER_SITEMAP_LIMIT,
): MetadataRoute.Sitemap {
  const seen = new Set<string>();
  const entries: MetadataRoute.Sitemap = [];

  for (const player of players) {
    if (!player.active) continue;
    if (player.type !== "PLAYER" && player.type !== "DEFENSE") continue;
    if (player.provider !== NFL_COM_BOOTSTRAP_PROVIDER) continue;
    const pathId = publicPlayerPathId(player).trim();
    if (!pathId || seen.has(pathId)) continue;
    seen.add(pathId);
    entries.push({
      url: absoluteUrl(`/players/${encodeURIComponent(pathId)}`),
      lastModified: player.updatedAt,
      changeFrequency: "weekly",
      priority: 0.5,
    });
    if (entries.length >= limit) break;
  }

  return entries;
}

export async function loadSitemapProfiles(): Promise<MetadataRoute.Sitemap> {
  const profiles = await prisma.universalProfile.findMany({
    where: {
      status: "ACTIVE",
      publicVisible: true,
    },
    select: {
      username: true,
      updatedAt: true,
      profileType: true,
      competitorActive: true,
      expertSource: { select: { sourceKind: true } },
    },
    take: PROFILE_SITEMAP_LIMIT * 2,
    orderBy: [{ competitorActive: "desc" }, { updatedAt: "desc" }],
  });

  const included = profiles
    .map((profile) => ({
      username: profile.username,
      updatedAt: profile.updatedAt,
      profileType: profile.profileType,
      competitorActive: profile.competitorActive,
      expertSourceKind: profile.expertSource?.sourceKind ?? null,
    }))
    .filter(shouldIncludeProfileInSitemap)
    .slice(0, PROFILE_SITEMAP_LIMIT);

  return included.map((profile) => ({
    url: absoluteUrl(`/profile/${profile.username}`),
    lastModified: profile.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.55,
  }));
}

/**
 * Indexable NFL player/DEF identities.
 * Prefer canonical nflcom-bootstrap rows that appear in an active season roster
 * or a contest pool — do NOT require week-stat joins (often empty pre-grade).
 * DEFENSE rows are loaded first (small set) so they are not crowded out by offense.
 */
export async function loadSitemapPlayers(): Promise<MetadataRoute.Sitemap> {
  const activeSeason = await prisma.season.findFirst({
    where: { active: true, sport: "NFL" },
    select: { id: true },
    orderBy: { year: "desc" },
  });

  const eligibility = {
    provider: NFL_COM_BOOTSTRAP_PROVIDER,
    active: true as const,
    OR: [
      activeSeason
        ? { seasonPlayers: { some: { seasonId: activeSeason.id } } }
        : { seasonPlayers: { some: {} } },
      { contestEntries: { some: {} } },
    ],
  };

  const select = {
    id: true,
    provider: true,
    externalId: true,
    updatedAt: true,
    type: true,
    active: true,
  };

  const [defenses, offense] = await Promise.all([
    prisma.rankableEntry.findMany({
      where: { ...eligibility, type: "DEFENSE" },
      select,
      orderBy: { name: "asc" },
      take: 40,
    }),
    prisma.rankableEntry.findMany({
      where: { ...eligibility, type: "PLAYER" },
      select,
      orderBy: [{ position: "asc" }, { name: "asc" }],
      take: PLAYER_SITEMAP_LIMIT * 2,
    }),
  ]);

  return buildPlayerSitemapEntries([...defenses, ...offense], PLAYER_SITEMAP_LIMIT);
}

export async function loadDynamicSitemapEntries(): Promise<MetadataRoute.Sitemap> {
  const [profiles, players] = await Promise.all([
    loadSitemapProfiles(),
    loadSitemapPlayers(),
  ]);
  return [...profiles, ...players];
}
