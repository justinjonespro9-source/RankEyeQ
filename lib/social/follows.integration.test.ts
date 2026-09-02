import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  FollowError,
  followFromSession,
  followProfile,
  getFollowCounts,
  unfollowProfile,
} from "@/lib/social/follows";

const suffix = `fol${Date.now()}`;

describe("follow graph", () => {
  let humanA = "";
  let humanB = "";
  let aiId = "";
  const extraIds: string[] = [];

  beforeAll(async () => {
    const [a, b, ai] = await Promise.all([
      prisma.universalProfile.create({
        data: {
          username: `fol_a_${suffix}`,
          displayName: "Follow A",
          profileType: "HUMAN",
        },
      }),
      prisma.universalProfile.create({
        data: {
          username: `fol_b_${suffix}`,
          displayName: "Follow B",
          profileType: "HUMAN",
        },
      }),
      prisma.universalProfile.create({
        data: {
          username: `fol_ai_${suffix}`,
          displayName: "Follow AI",
          profileType: "AI",
        },
      }),
    ]);
    humanA = a.id;
    humanB = b.id;
    aiId = ai.id;
  });

  afterAll(async () => {
    await prisma.profileFollow.deleteMany({
      where: {
        OR: [
          { followerProfileId: { in: [humanA, humanB, aiId, ...extraIds] } },
          { followedProfileId: { in: [humanA, humanB, aiId, ...extraIds] } },
        ],
      },
    });
    await prisma.universalProfile.deleteMany({
      where: { id: { in: [humanA, humanB, aiId, ...extraIds] } },
    });
  });

  it("follows a human and an AI profile", async () => {
    await followProfile({
      followerProfileId: humanA,
      followedProfileId: humanB,
    });
    await followProfile({
      followerProfileId: humanA,
      followedProfileId: aiId,
    });
    const countsB = await getFollowCounts(humanB);
    const countsAi = await getFollowCounts(aiId);
    const countsA = await getFollowCounts(humanA);
    expect(countsB.followers).toBe(1);
    expect(countsAi.followers).toBe(1);
    expect(countsA.following).toBe(2);
  });

  it("unfollows a profile", async () => {
    await unfollowProfile({
      followerProfileId: humanA,
      followedProfileId: aiId,
    });
    const counts = await getFollowCounts(aiId);
    expect(counts.followers).toBe(0);
  });

  it("cannot follow a benchmark source", async () => {
    const bench = await prisma.universalProfile.create({
      data: {
        username: `fol_bm_${suffix}`,
        displayName: "Follow Benchmark",
        profileType: "BENCHMARK",
      },
    });
    extraIds.push(bench.id);
    await expect(
      followProfile({
        followerProfileId: humanA,
        followedProfileId: bench.id,
      }),
    ).rejects.toMatchObject({
      message: "Benchmark sources cannot be followed",
    });
  });

  it("cannot follow self", async () => {
    await expect(
      followProfile({
        followerProfileId: humanA,
        followedProfileId: humanA,
      }),
    ).rejects.toBeInstanceOf(FollowError);
  });

  it("cannot duplicate follow", async () => {
    await expect(
      followProfile({
        followerProfileId: humanA,
        followedProfileId: humanB,
      }),
    ).rejects.toMatchObject({ message: "Already following this profile" });
  });

  it("suspended profile cannot gain new followers", async () => {
    const suspended = await prisma.universalProfile.create({
      data: {
        username: `fol_sus_${suffix}`,
        displayName: "Suspended",
        profileType: "HUMAN",
        status: "SUSPENDED",
      },
    });
    extraIds.push(suspended.id);
    await expect(
      followProfile({
        followerProfileId: humanA,
        followedProfileId: suspended.id,
      }),
    ).rejects.toMatchObject({
      message: "This profile cannot gain new followers",
    });
  });

  it("keeps historical follows after the followed profile is suspended", async () => {
    await prisma.universalProfile.update({
      where: { id: humanB },
      data: { status: "SUSPENDED" },
    });
    const counts = await getFollowCounts(humanB);
    expect(counts.followers).toBe(1);
    await prisma.universalProfile.update({
      where: { id: humanB },
      data: { status: "ACTIVE" },
    });
  });

  it("signed-out user cannot follow", async () => {
    await expect(
      followFromSession({
        signedIn: false,
        followerProfileId: null,
        followedProfileId: humanB,
      }),
    ).rejects.toMatchObject({ message: "Sign in to follow profiles" });
  });
});
