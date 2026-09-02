import { prisma } from "@/lib/db";
import type {
  BoardRevealPreference,
  ContestPosition,
  ProfileType,
} from "@/lib/generated/prisma/client";
import {
  getActiveSeasonAndWeek,
  getSeasonLeaderboard,
} from "@/lib/leaderboards";
import { getFollowerCountsForProfiles } from "@/lib/social/follows";
import { isPremiumRevealBoard } from "@/lib/social/creator";
import {
  canViewCurrentWeekBoard,
  getBoardRevealEntitlement,
  type BoardViewer,
} from "@/lib/timing/board-access";
import { findMatchingEntitlement } from "@/lib/social/entitlements";
import { getWeekTimingState } from "@/lib/timing/week-windows";

export type FollowingBoardAccessState =
  | "none"
  | "pre_lock"
  | "free_reveal"
  | "premium_gated"
  | "premium_unlocked"
  | "public"
  | "owner";

export type FollowingFeedItem = {
  profileId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  profileType: ProfileType;
  overallRank: number | null;
  bestPosition: ContestPosition | null;
  bestPositionRank: number | null;
  averageScore: number | null;
  recentScores: number[];
  followerCount: number;
  creatorEnabled: boolean;
  currentWeekBoard: {
    exists: boolean;
    position: ContestPosition | null;
    accessState: FollowingBoardAccessState;
    revealPreference: BoardRevealPreference | null;
  };
};

export type FollowingFeedFilter =
  | "ALL"
  | "HUMAN"
  | "AI"
  | ContestPosition;

export async function getFollowingFeed(input: {
  followerProfileId: string;
  viewer: BoardViewer;
  filter?: FollowingFeedFilter;
  now?: Date;
}): Promise<FollowingFeedItem[]> {
  const now = input.now ?? new Date();
  const follows = await prisma.profileFollow.findMany({
    where: { followerProfileId: input.followerProfileId },
    orderBy: { createdAt: "desc" },
    include: {
      followed: {
        include: { creatorProfile: true },
      },
    },
  });

  let profiles = follows.map((row) => row.followed);
  const filter = input.filter ?? "ALL";
  if (filter === "HUMAN" || filter === "AI") {
    profiles = profiles.filter((profile) => profile.profileType === filter);
  }

  const context = await getActiveSeasonAndWeek();
  const seasonId = context?.season.id;
  const currentWeek = context?.week ?? null;

  const overall =
    seasonId != null
      ? await getSeasonLeaderboard({ seasonId, filter: "ALL" })
      : [];
  const positionBoards = new Map<ContestPosition, typeof overall>();
  if (seasonId) {
    for (const position of ["QB", "RB", "WR", "TE", "DEF"] as ContestPosition[]) {
      positionBoards.set(
        position,
        await getSeasonLeaderboard({ seasonId, position, filter: "ALL" }),
      );
    }
  }

  if (
    filter === "QB" ||
    filter === "RB" ||
    filter === "WR" ||
    filter === "TE" ||
    filter === "DEF"
  ) {
    const board = positionBoards.get(filter) ?? [];
    const rankedIds = new Set(board.map((row) => row.universalProfileId));
    profiles = profiles.filter((profile) => rankedIds.has(profile.id));
  }

  const profileIds = profiles.map((profile) => profile.id);
  const followerCounts = await getFollowerCountsForProfiles(profileIds);

  const graded = profileIds.length
    ? await prisma.rankingSubmission.findMany({
        where: {
          universalProfileId: { in: profileIds },
          status: "GRADED",
          normalizedScore: { not: null },
        },
        orderBy: { updatedAt: "desc" },
        select: {
          universalProfileId: true,
          normalizedScore: true,
        },
      })
    : [];

  const recentByProfile = new Map<string, number[]>();
  for (const row of graded) {
    const list = recentByProfile.get(row.universalProfileId) ?? [];
    if (list.length < 5 && row.normalizedScore != null) {
      list.push(row.normalizedScore);
      recentByProfile.set(row.universalProfileId, list);
    }
  }

  const currentBoards = currentWeek
    ? await prisma.rankingSubmission.findMany({
        where: {
          universalProfileId: { in: profileIds },
          contest: { weekId: currentWeek.id },
          status: { in: ["SUBMITTED", "LOCKED", "GRADED"] },
        },
        include: {
          contest: true,
        },
      })
    : [];
  const boardsByProfile = new Map(
    currentBoards.map((row) => [row.universalProfileId, row]),
  );

  const entitlementStub = getBoardRevealEntitlement(input.viewer);
  const timing = currentWeek
    ? getWeekTimingState({
        rankingsOpenAt: currentWeek.rankingsOpenAt,
        fullLockAt: currentWeek.fullLockAt,
        revealStartsAt: currentWeek.revealStartsAt,
        publicReleaseAt: currentWeek.publicReleaseAt,
        weekStatus: currentWeek.status,
        now,
      })
    : null;

  const items: FollowingFeedItem[] = [];
  for (const profile of profiles) {
    const overallRow = overall.find(
      (row) => row.universalProfileId === profile.id,
    );
    let bestPosition: ContestPosition | null = null;
    let bestPositionRank: number | null = null;
    for (const [position, board] of positionBoards) {
      const rank =
        board.find((row) => row.universalProfileId === profile.id)?.rank ??
        null;
      if (rank == null) continue;
      if (bestPositionRank == null || rank < bestPositionRank) {
        bestPosition = position;
        bestPositionRank = rank;
      }
    }

    const board = boardsByProfile.get(profile.id) ?? null;
    const creatorEnabled = profile.creatorProfile?.enabled === true;
    let accessState: FollowingBoardAccessState = "none";
    if (!board || !currentWeek || !timing) {
      accessState = "none";
    } else if (input.viewer.profileId === profile.id) {
      accessState = "owner";
    } else if (timing.boardsPublic) {
      accessState = "public";
    } else if (!timing.fullBoardLocked) {
      accessState = "pre_lock";
    } else {
      const premium = isPremiumRevealBoard({
        creatorEnabled,
        revealPreference: board.revealPreference,
      });
      let hasMatchingEntitlement = false;
      if (premium && input.viewer.profileId) {
        const match = await findMatchingEntitlement({
          viewerProfileId: input.viewer.profileId,
          creatorProfileId: profile.id,
          contestId: board.contestId,
          weekId: currentWeek.id,
          now,
        });
        hasMatchingEntitlement = Boolean(match);
      }
      const allowed = canViewCurrentWeekBoard({
        viewer: input.viewer,
        targetProfileId: profile.id,
        week: currentWeek,
        contest: board.contest,
        entitlement: entitlementStub,
        revealPreference: board.revealPreference,
        creatorEnabled,
        hasMatchingEntitlement,
        now,
      });
      if (premium && !allowed) accessState = "premium_gated";
      else if (premium && allowed) accessState = "premium_unlocked";
      else accessState = "free_reveal";
    }

    items.push({
      profileId: profile.id,
      username: profile.username,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      profileType: profile.profileType,
      overallRank: overallRow?.rank ?? null,
      bestPosition,
      bestPositionRank,
      averageScore: overallRow?.averageScore ?? null,
      recentScores: recentByProfile.get(profile.id) ?? [],
      followerCount: followerCounts.get(profile.id) ?? 0,
      creatorEnabled,
      currentWeekBoard: {
        exists: Boolean(board),
        position: board?.contest.position ?? null,
        accessState,
        revealPreference: board?.revealPreference ?? null,
      },
    });
  }

  if (
    filter === "QB" ||
    filter === "RB" ||
    filter === "WR" ||
    filter === "TE" ||
    filter === "DEF"
  ) {
    items.sort((a, b) => {
      const ar = a.bestPosition === filter ? (a.bestPositionRank ?? 9999) : 9999;
      const br = b.bestPosition === filter ? (b.bestPositionRank ?? 9999) : 9999;
      return ar - br;
    });
  } else {
    items.sort((a, b) => {
      const ar = a.overallRank ?? 9999;
      const br = b.overallRank ?? 9999;
      if (ar !== br) return ar - br;
      return a.displayName.localeCompare(b.displayName);
    });
  }

  return items;
}

export function parseFollowingFilter(
  value: string | undefined,
): FollowingFeedFilter {
  const upper = value?.toUpperCase();
  if (
    upper === "ALL" ||
    upper === "HUMAN" ||
    upper === "AI" ||
    upper === "QB" ||
    upper === "RB" ||
    upper === "WR" ||
    upper === "TE" ||
    upper === "DEF"
  ) {
    return upper;
  }
  return "ALL";
}
