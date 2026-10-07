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

  it("follows analyst Expert and Creator competitors through the same follow graph", async () => {
    const [bench, creator] = await Promise.all([
      prisma.universalProfile.create({
        data: {
          username: `fol_bm_${suffix}`,
          displayName: "Follow Expert",
          profileType: "BENCHMARK",
          expertSource: { create: { sourceKind: "ANALYST", analystName: "Follow Expert", publicationName: "Test Pub" } },
        },
      }),
      prisma.universalProfile.create({
        data: { username: `fol_cr_${suffix}`, displayName: "Follow Creator", profileType: "CREATOR" },
      }),
    ]);
    extraIds.push(bench.id, creator.id);
    await followProfile({ followerProfileId: humanA, followedProfileId: bench.id });
    await followProfile({ followerProfileId: humanA, followedProfileId: creator.id });
    expect((await getFollowCounts(bench.id)).followers).toBe(1);
    expect((await getFollowCounts(creator.id)).followers).toBe(1);
  });

  it("publisher / site consensus, legacy publisher shells and unclassified benchmarks cannot be followed", async () => {
    const kinds = ["PUBLISHER_CONSENSUS", "SITE_CONSENSUS", "PUBLISHER", null] as const;
    const profiles = await Promise.all(
      kinds.map((sourceKind, i) =>
        prisma.universalProfile.create({
          data: {
            username: `fol_pc${i}_${suffix}`,
            displayName: `Follow Consensus ${i}`,
            profileType: "BENCHMARK",
            ...(sourceKind ? { expertSource: { create: { sourceKind, publicationName: "Test Consensus" } } } : {}),
          },
        }),
      ),
    );
    extraIds.push(...profiles.map((p) => p.id));
    for (const p of profiles) {
      await expect(followProfile({ followerProfileId: humanA, followedProfileId: p.id })).rejects.toMatchObject({
        message: "Consensus and publisher benchmarks cannot be followed",
      });
      expect((await getFollowCounts(p.id)).followers).toBe(0);
    }
  });

  it("non-human profiles still cannot follow", async () => {
    await expect(
      followProfile({ followerProfileId: aiId, followedProfileId: humanA }),
    ).rejects.toMatchObject({ message: "Only human accounts can follow profiles" });
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
