import { prisma } from "@/lib/db";

export class FollowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FollowError";
  }
}

export async function followFromSession(input: {
  signedIn: boolean;
  followerProfileId: string | null;
  followedProfileId: string;
}) {
  if (!input.signedIn || !input.followerProfileId) {
    throw new FollowError("Sign in to follow profiles");
  }
  return followProfile({
    followerProfileId: input.followerProfileId,
    followedProfileId: input.followedProfileId,
  });
}

export async function unfollowFromSession(input: {
  signedIn: boolean;
  followerProfileId: string | null;
  followedProfileId: string;
}) {
  if (!input.signedIn || !input.followerProfileId) {
    throw new FollowError("Sign in to unfollow profiles");
  }
  return unfollowProfile({
    followerProfileId: input.followerProfileId,
    followedProfileId: input.followedProfileId,
  });
}

export async function followProfile(input: {
  followerProfileId: string;
  followedProfileId: string;
}) {
  if (input.followerProfileId === input.followedProfileId) {
    throw new FollowError("You cannot follow yourself");
  }

  const [follower, followed] = await Promise.all([
    prisma.universalProfile.findUnique({
      where: { id: input.followerProfileId },
    }),
    prisma.universalProfile.findUnique({
      where: { id: input.followedProfileId },
    }),
  ]);

  if (!follower) throw new FollowError("Follower profile not found");
  if (follower.profileType !== "HUMAN") {
    throw new FollowError("Only human accounts can follow profiles");
  }
  if (follower.status === "SUSPENDED") {
    throw new FollowError("Suspended accounts cannot follow");
  }
  if (!followed) throw new FollowError("Profile not found");
  if (followed.profileType === "BENCHMARK") {
    throw new FollowError("Benchmark sources cannot be followed");
  }
  if (followed.status === "SUSPENDED") {
    throw new FollowError("This profile cannot gain new followers");
  }

  const existing = await prisma.profileFollow.findUnique({
    where: {
      followerProfileId_followedProfileId: {
        followerProfileId: input.followerProfileId,
        followedProfileId: input.followedProfileId,
      },
    },
  });
  if (existing) {
    throw new FollowError("Already following this profile");
  }

  return prisma.profileFollow.create({
    data: {
      followerProfileId: input.followerProfileId,
      followedProfileId: input.followedProfileId,
    },
  });
}

export async function unfollowProfile(input: {
  followerProfileId: string;
  followedProfileId: string;
}) {
  const existing = await prisma.profileFollow.findUnique({
    where: {
      followerProfileId_followedProfileId: {
        followerProfileId: input.followerProfileId,
        followedProfileId: input.followedProfileId,
      },
    },
  });
  if (!existing) return null;

  await prisma.profileFollow.delete({
    where: { id: existing.id },
  });
  return existing;
}

export async function isFollowing(
  followerProfileId: string,
  followedProfileId: string,
) {
  const row = await prisma.profileFollow.findUnique({
    where: {
      followerProfileId_followedProfileId: {
        followerProfileId,
        followedProfileId,
      },
    },
    select: { id: true },
  });
  return Boolean(row);
}

export async function getFollowCounts(profileId: string) {
  const [followers, following] = await Promise.all([
    prisma.profileFollow.count({ where: { followedProfileId: profileId } }),
    prisma.profileFollow.count({ where: { followerProfileId: profileId } }),
  ]);
  return { followers, following };
}

export async function getFollowerCountsForProfiles(profileIds: string[]) {
  const counts = new Map<string, number>();
  if (profileIds.length === 0) return counts;
  for (const id of profileIds) counts.set(id, 0);

  const rows = await prisma.profileFollow.groupBy({
    by: ["followedProfileId"],
    where: { followedProfileId: { in: profileIds } },
    _count: { _all: true },
  });
  for (const row of rows) {
    counts.set(row.followedProfileId, row._count._all);
  }
  return counts;
}

export async function getFollowingIdSet(followerProfileId: string) {
  const rows = await prisma.profileFollow.findMany({
    where: { followerProfileId },
    select: { followedProfileId: true },
  });
  return new Set(rows.map((row) => row.followedProfileId));
}

export async function listFollowedProfiles(followerProfileId: string) {
  return prisma.profileFollow.findMany({
    where: { followerProfileId },
    orderBy: { createdAt: "desc" },
    include: {
      followed: true,
    },
  });
}
