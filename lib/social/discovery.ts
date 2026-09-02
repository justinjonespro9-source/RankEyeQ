import { prisma } from "@/lib/db";
import type {
  ContestPosition,
  ProfileType,
} from "@/lib/generated/prisma/client";
import {
  getActiveSeasonAndWeek,
  getSeasonLeaderboard,
  type LeaderboardFilter,
  type LeaderboardRow,
} from "@/lib/leaderboards";
import { getFollowerCountsForProfiles } from "@/lib/social/follows";

export const DISCOVERY_MIN_CONTESTS = 5;

export type RankerDiscoveryFilter = LeaderboardFilter;

export type RankerDiscoveryRow = LeaderboardRow & {
  followerCount: number;
  creatorEnabled: boolean;
  qualified: boolean;
  avatarUrl: string | null;
};

export async function getRankerDiscovery(input: {
  position?: ContestPosition;
  filter?: RankerDiscoveryFilter;
  minContests?: number;
}): Promise<{
  rows: RankerDiscoveryRow[];
  minContests: number;
  seasonYear: number | null;
}> {
  const minContests = input.minContests ?? DISCOVERY_MIN_CONTESTS;
  const context = await getActiveSeasonAndWeek();
  if (!context?.season) {
    return { rows: [], minContests, seasonYear: null };
  }

  const leaderboard = await getSeasonLeaderboard({
    seasonId: context.season.id,
    position: input.position,
    filter: input.filter ?? "ALL",
    minContests,
  });

  const profileIds = leaderboard.map((row) => row.universalProfileId);
  const [followerCounts, profiles] = await Promise.all([
    getFollowerCountsForProfiles(profileIds),
    profileIds.length === 0
      ? Promise.resolve([])
      : prisma.universalProfile.findMany({
          where: { id: { in: profileIds } },
          select: {
            id: true,
            avatarUrl: true,
            creatorProfile: { select: { enabled: true } },
            _count: { select: { submissions: true } },
          },
        }),
  ]);

  const gradedCounts = new Map<string, number>();
  if (profileIds.length > 0) {
    const graded = await prisma.rankingSubmission.groupBy({
      by: ["universalProfileId"],
      where: {
        universalProfileId: { in: profileIds },
        status: "GRADED",
      },
      _count: { _all: true },
    });
    for (const row of graded) {
      gradedCounts.set(row.universalProfileId, row._count._all);
    }
  }

  const profileMap = new Map(
    profiles.map((profile) => [
      profile.id,
      {
        avatarUrl: profile.avatarUrl,
        creatorEnabled: profile.creatorProfile?.enabled === true,
      },
    ]),
  );

  const rows: RankerDiscoveryRow[] = leaderboard.map((row) => {
    const extra = profileMap.get(row.universalProfileId);
    const graded = gradedCounts.get(row.universalProfileId) ?? row.contestsPlayed;
    return {
      ...row,
      followerCount: followerCounts.get(row.universalProfileId) ?? 0,
      creatorEnabled: extra?.creatorEnabled ?? false,
      qualified: graded >= 10 && row.profileType === "HUMAN",
      avatarUrl: extra?.avatarUrl ?? null,
    };
  });

  return {
    rows,
    minContests,
    seasonYear: context.season.year,
  };
}

export function filterDiscoveryByProfileType(
  filter: string | undefined,
): RankerDiscoveryFilter {
  if (filter === "HUMAN" || filter === "AI" || filter === "EXPERT") return filter;
  return "ALL";
}

export function parseDiscoveryPosition(
  value: string | undefined,
): ContestPosition | undefined {
  const upper = value?.toUpperCase();
  if (
    upper === "QB" ||
    upper === "RB" ||
    upper === "WR" ||
    upper === "TE" ||
    upper === "DEF"
  ) {
    return upper;
  }
  return undefined;
}

export type { ProfileType };
