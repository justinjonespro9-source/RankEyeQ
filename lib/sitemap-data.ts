import type { MetadataRoute } from "next";
import { isOfficialBenchmarkUsername } from "@/lib/benchmark-sources";
import { prisma } from "@/lib/db";
import type {
  ContestPosition,
  ProfileType,
} from "@/lib/generated/prisma/client";
import { EXPERT_SOURCE_KIND } from "@/lib/expert-identity";
import { publicPlayerPathId } from "@/lib/player-detail-queries";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";
import { absoluteUrl } from "@/lib/seo";

export const PROFILE_SITEMAP_LIMIT = 300;
export const PLAYER_SITEMAP_LIMIT = 200;

/** Position-balanced sitemap budget (sums to PLAYER_SITEMAP_LIMIT). */
export const SITEMAP_POSITION_CAPS = {
  QB: 35,
  RB: 50,
  WR: 55,
  TE: 28,
  DEF: 32,
} as const satisfies Record<ContestPosition, number>;

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
  name: string;
  updatedAt: Date;
  type: "PLAYER" | "DEFENSE" | string;
  position: ContestPosition | string;
  active: boolean;
  /** In a RankEyeQ contest pool (any week). */
  inContestPool: boolean;
  /** On the active season roster. */
  inSeasonRoster: boolean;
};

function isCanonicalSitemapPlayer(player: SitemapPlayerCandidate): boolean {
  return (
    player.active &&
    player.provider === NFL_COM_BOOTSTRAP_PROVIDER &&
    (player.type === "PLAYER" || player.type === "DEFENSE") &&
    Boolean(publicPlayerPathId(player).trim())
  );
}

/** Sort key: contest pool → season roster → name → externalId (deterministic). */
export function compareSitemapPlayerPriority(
  a: SitemapPlayerCandidate,
  b: SitemapPlayerCandidate,
): number {
  if (a.inContestPool !== b.inContestPool) {
    return a.inContestPool ? -1 : 1;
  }
  if (a.inSeasonRoster !== b.inSeasonRoster) {
    return a.inSeasonRoster ? -1 : 1;
  }
  const byName = a.name.localeCompare(b.name, "en");
  if (byName !== 0) return byName;
  return a.externalId.localeCompare(b.externalId, "en");
}

/**
 * Position-balanced selection under SITEMAP_POSITION_CAPS.
 * Dedupes by canonical path id; no position may exceed its cap.
 */
export function selectBalancedSitemapPlayers(
  candidates: SitemapPlayerCandidate[],
  caps: Record<ContestPosition, number> = SITEMAP_POSITION_CAPS,
): SitemapPlayerCandidate[] {
  const byPath = new Map<string, SitemapPlayerCandidate>();

  for (const player of candidates) {
    if (!isCanonicalSitemapPlayer(player)) continue;
    const pathId = publicPlayerPathId(player).trim();
    const existing = byPath.get(pathId);
    if (!existing || compareSitemapPlayerPriority(player, existing) < 0) {
      byPath.set(pathId, player);
    }
  }

  const byPosition = new Map<ContestPosition, SitemapPlayerCandidate[]>();
  for (const player of byPath.values()) {
    const position = (
      player.type === "DEFENSE" ? "DEF" : player.position
    ) as ContestPosition;
    if (!(position in caps)) continue;
    const bucket = byPosition.get(position) ?? [];
    bucket.push(player);
    byPosition.set(position, bucket);
  }

  const selected: SitemapPlayerCandidate[] = [];
  for (const position of Object.keys(caps) as ContestPosition[]) {
    const cap = caps[position];
    const bucket = (byPosition.get(position) ?? []).sort(
      compareSitemapPlayerPriority,
    );
    selected.push(...bucket.slice(0, cap));
  }

  // Stable overall order: position enum order then priority within position.
  const positionOrder: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];
  selected.sort((a, b) => {
    const posA = (a.type === "DEFENSE" ? "DEF" : a.position) as ContestPosition;
    const posB = (b.type === "DEFENSE" ? "DEF" : b.position) as ContestPosition;
    const order = positionOrder.indexOf(posA) - positionOrder.indexOf(posB);
    if (order !== 0) return order;
    return compareSitemapPlayerPriority(a, b);
  });

  return selected;
}

export function playerCandidatesToSitemapEntries(
  players: SitemapPlayerCandidate[],
): MetadataRoute.Sitemap {
  return players.map((player) => ({
    url: absoluteUrl(
      `/players/${encodeURIComponent(publicPlayerPathId(player).trim())}`,
    ),
    lastModified: player.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.5,
  }));
}

/** @deprecated Prefer selectBalancedSitemapPlayers — kept for narrow unit tests. */
export function buildPlayerSitemapEntries(
  players: Array<
    Omit<
      SitemapPlayerCandidate,
      "name" | "position" | "inContestPool" | "inSeasonRoster"
    > &
      Partial<
        Pick<
          SitemapPlayerCandidate,
          "name" | "position" | "inContestPool" | "inSeasonRoster"
        >
      >
  >,
  limit = PLAYER_SITEMAP_LIMIT,
): MetadataRoute.Sitemap {
  const normalized: SitemapPlayerCandidate[] = players.map((player) => ({
    name: player.name ?? player.externalId,
    position:
      player.position ??
      (player.type === "DEFENSE" ? "DEF" : ("QB" as ContestPosition)),
    inContestPool: player.inContestPool ?? true,
    inSeasonRoster: player.inSeasonRoster ?? true,
    ...player,
  }));
  return playerCandidatesToSitemapEntries(
    selectBalancedSitemapPlayers(normalized).slice(0, limit),
  );
}

export function countSitemapPlayersByPosition(
  players: SitemapPlayerCandidate[],
): Record<ContestPosition, number> {
  const counts: Record<ContestPosition, number> = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    DEF: 0,
  };
  for (const player of players) {
    const position = (
      player.type === "DEFENSE" ? "DEF" : player.position
    ) as ContestPosition;
    if (position in counts) counts[position] += 1;
  }
  return counts;
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
 * Indexable NFL player/DEF identities with position-balanced caps.
 * Prefer contest-pool membership, then active season roster, then stable
 * nflcom-bootstrap identity — never week-stat joins or editorial rankings.
 */
export async function loadSitemapPlayers(): Promise<MetadataRoute.Sitemap> {
  const activeSeason = await prisma.season.findFirst({
    where: { active: true, sport: "NFL" },
    select: { id: true },
    orderBy: { year: "desc" },
  });

  const positions = Object.keys(SITEMAP_POSITION_CAPS) as ContestPosition[];

  const batches = await Promise.all(
    positions.map(async (position) => {
      const cap = SITEMAP_POSITION_CAPS[position];
      // Fetch a modest overselect per position so pool/roster priority can win.
      const take = Math.min(cap * 4, position === "DEF" ? 40 : 120);
      const rows = await prisma.rankableEntry.findMany({
        where: {
          provider: NFL_COM_BOOTSTRAP_PROVIDER,
          active: true,
          position,
          type: position === "DEF" ? "DEFENSE" : "PLAYER",
          OR: [
            activeSeason
              ? { seasonPlayers: { some: { seasonId: activeSeason.id } } }
              : { seasonPlayers: { some: {} } },
            { contestEntries: { some: {} } },
          ],
        },
        select: {
          id: true,
          provider: true,
          externalId: true,
          name: true,
          updatedAt: true,
          type: true,
          position: true,
          active: true,
          contestEntries: { select: { id: true }, take: 1 },
          seasonPlayers: activeSeason
            ? {
                where: { seasonId: activeSeason.id },
                select: { id: true },
                take: 1,
              }
            : { select: { id: true }, take: 1 },
        },
        orderBy: { name: "asc" },
        take,
      });

      return rows.map(
        (row): SitemapPlayerCandidate => ({
          id: row.id,
          provider: row.provider,
          externalId: row.externalId,
          name: row.name,
          updatedAt: row.updatedAt,
          type: row.type,
          position: row.position,
          active: row.active,
          inContestPool: row.contestEntries.length > 0,
          inSeasonRoster: row.seasonPlayers.length > 0,
        }),
      );
    }),
  );

  const selected = selectBalancedSitemapPlayers(batches.flat());
  return playerCandidatesToSitemapEntries(selected);
}

export async function loadDynamicSitemapEntries(): Promise<MetadataRoute.Sitemap> {
  const [profiles, players] = await Promise.all([
    loadSitemapProfiles(),
    loadSitemapPlayers(),
  ]);
  return [...profiles, ...players];
}
