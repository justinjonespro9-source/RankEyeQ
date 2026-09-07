import { isCreatorVerified } from "@/lib/creator-verification-shared";
import {
  CreatorVerificationError,
  approveCreatorClaimLink,
  approveCreatorVerificationInPlace,
  rejectCreatorVerification,
  requestCreatorVerification,
  validatePublicHttpUrl,
} from "@/lib/creator-verification";
import { canAuthenticateAsParticipant } from "@/lib/auth/participation";
import { competitorIdentityChip } from "@/lib/profile-labels";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

const suffix = `cv${Date.now()}`;

describe("creator verification helpers", () => {
  it("defaults PUBLIC chip and keeps CREATOR class separate from Expert", () => {
    expect(competitorIdentityChip({ profileType: "HUMAN" }).label).toBe(
      "PUBLIC",
    );
    expect(
      competitorIdentityChip({
        profileType: "CREATOR",
        creatorBrand: "TCO Fantasy Show",
      }).label,
    ).toBe("CREATOR · TCO Fantasy Show");
    expect(
      competitorIdentityChip({
        profileType: "BENCHMARK",
        expertPublisher: "Yahoo Fantasy",
      }).label,
    ).toBe("EXPERT · Yahoo Fantasy");
  });

  it("only marks verified when CREATOR + VERIFIED", () => {
    expect(
      isCreatorVerified({ profileType: "CREATOR", claimStatus: "UNCLAIMED" }),
    ).toBe(false);
    expect(
      isCreatorVerified({ profileType: "CREATOR", claimStatus: "REQUESTED" }),
    ).toBe(false);
    expect(
      isCreatorVerified({ profileType: "HUMAN", claimStatus: "VERIFIED" }),
    ).toBe(false);
    expect(
      isCreatorVerified({ profileType: "CREATOR", claimStatus: "VERIFIED" }),
    ).toBe(true);
  });

  it("allows HUMAN and CREATOR to authenticate as participants", () => {
    expect(canAuthenticateAsParticipant("HUMAN")).toBe(true);
    expect(canAuthenticateAsParticipant("CREATOR")).toBe(true);
    expect(canAuthenticateAsParticipant("AI")).toBe(false);
    expect(canAuthenticateAsParticipant("BENCHMARK")).toBe(false);
  });

  it("validates public http(s) URLs and rejects unsafe schemes", () => {
    expect(validatePublicHttpUrl("https://example.com/x").ok).toBe(true);
    expect(validatePublicHttpUrl("javascript:alert(1)").ok).toBe(false);
    expect(validatePublicHttpUrl("not-a-url").ok).toBe(false);
    expect(validatePublicHttpUrl("ftp://example.com").ok).toBe(false);
  });
});

describe("creator verification request + admin review", () => {
  let userId = "";
  let profileId = "";
  let adminUserId = "";
  let trackedCreatorId = "";

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `${suffix}@example.com`,
        role: "USER",
        name: "Claim Tester",
      },
    });
    userId = user.id;
    const profile = await prisma.universalProfile.create({
      data: {
        username: `pub_${suffix}`.slice(0, 24),
        displayName: "Public Ranker",
        profileType: "HUMAN",
      },
    });
    profileId = profile.id;
    await prisma.user.update({
      where: { id: userId },
      data: { universalProfileId: profileId },
    });

    const admin = await prisma.user.create({
      data: {
        email: `admin_${suffix}@example.com`,
        role: "ADMIN",
      },
    });
    adminUserId = admin.id;

    const tracked = await prisma.universalProfile.create({
      data: {
        username: `trk_${suffix}`.slice(0, 24),
        displayName: "Tracked Creator",
        profileType: "CREATOR",
        creatorCompetitor: {
          create: {
            personName: "Tracked Creator",
            brandName: "Tracked Show",
            claimStatus: "UNCLAIMED",
          },
        },
      },
    });
    trackedCreatorId = tracked.id;
  });

  afterAll(async () => {
    await prisma.creatorCompetitorProfile.deleteMany({
      where: {
        OR: [
          { universalProfileId: profileId },
          { universalProfileId: trackedCreatorId },
        ],
      },
    });
    await prisma.user.updateMany({
      where: { id: { in: [userId, adminUserId] } },
      data: { universalProfileId: null },
    });
    await prisma.universalProfile.deleteMany({
      where: { id: { in: [profileId, trackedCreatorId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userId, adminUserId] } },
    });
  });

  it("request creates REQUESTED only and does not self-promote to CREATOR", async () => {
    const row = await requestCreatorVerification({
      profileId,
      creatorSiteUrl: "https://example.com/ranks",
      socialHandle: "@gridfan",
      publicProofUrl: "https://example.com/proof",
      brandName: "Grid Fan Show",
    });
    expect(row.claimStatus).toBe("REQUESTED");

    const profile = await prisma.universalProfile.findUniqueOrThrow({
      where: { id: profileId },
    });
    expect(profile.profileType).toBe("HUMAN");
  });

  it("rejects a second concurrent request while REQUESTED", async () => {
    await expect(
      requestCreatorVerification({
        profileId,
        creatorSiteUrl: "https://example.com/ranks",
        socialHandle: "@gridfan",
        publicProofUrl: "https://example.com/proof",
      }),
    ).rejects.toBeInstanceOf(CreatorVerificationError);
  });

  it("reject leaves user PUBLIC with REJECTED status", async () => {
    await rejectCreatorVerification({
      requestingProfileId: profileId,
      adminUserId,
      verificationNotes: "Insufficient proof",
    });
    const profile = await prisma.universalProfile.findUniqueOrThrow({
      where: { id: profileId },
      include: { creatorCompetitor: true },
    });
    expect(profile.profileType).toBe("HUMAN");
    expect(profile.creatorCompetitor?.claimStatus).toBe("REJECTED");
  });

  it("approve in place produces VERIFIED creator on the same UniversalProfile", async () => {
    await requestCreatorVerification({
      profileId,
      creatorSiteUrl: "https://example.com/ranks",
      socialHandle: "@gridfan",
      publicProofUrl: "https://example.com/proof",
      brandName: "Grid Fan Show",
    });

    const beforeSubs = await prisma.rankingSubmission.count({
      where: { universalProfileId: profileId },
    });

    await approveCreatorVerificationInPlace({
      requestingProfileId: profileId,
      adminUserId,
    });

    const profile = await prisma.universalProfile.findUniqueOrThrow({
      where: { id: profileId },
      include: { creatorCompetitor: true },
    });
    expect(profile.profileType).toBe("CREATOR");
    expect(profile.creatorCompetitor?.claimStatus).toBe("VERIFIED");
    expect(
      isCreatorVerified({
        profileType: profile.profileType,
        claimStatus: profile.creatorCompetitor?.claimStatus,
      }),
    ).toBe(true);
    expect(
      competitorIdentityChip({
        profileType: profile.profileType,
        creatorBrand: profile.creatorCompetitor?.brandName,
      }).label,
    ).toBe("CREATOR · Grid Fan Show");

    const afterSubs = await prisma.rankingSubmission.count({
      where: { universalProfileId: profileId },
    });
    expect(afterSubs).toBe(beforeSubs);
  });

  it("tracked creator can remain CREATOR but unverified", async () => {
    const tracked = await prisma.universalProfile.findUniqueOrThrow({
      where: { id: trackedCreatorId },
      include: { creatorCompetitor: true },
    });
    expect(tracked.profileType).toBe("CREATOR");
    expect(tracked.creatorCompetitor?.claimStatus).toBe("UNCLAIMED");
    expect(
      isCreatorVerified({
        profileType: tracked.profileType,
        claimStatus: tracked.creatorCompetitor?.claimStatus,
      }),
    ).toBe(false);
  });
});

describe("creator claim link to tracked profile", () => {
  const linkSuffix = `lnk${Date.now()}`;
  let userId = "";
  let humanId = "";
  let trackedId = "";
  let adminId = "";

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `${linkSuffix}@example.com`,
        role: "USER",
      },
    });
    userId = user.id;
    const human = await prisma.universalProfile.create({
      data: {
        username: `h_${linkSuffix}`.slice(0, 24),
        displayName: "Human Claimer",
        profileType: "HUMAN",
      },
    });
    humanId = human.id;
    await prisma.user.update({
      where: { id: userId },
      data: { universalProfileId: humanId },
    });
    const tracked = await prisma.universalProfile.create({
      data: {
        username: `c_${linkSuffix}`.slice(0, 24),
        displayName: "Imported Creator",
        profileType: "CREATOR",
        creatorCompetitor: {
          create: {
            personName: "Imported Creator",
            brandName: "Import Show",
            claimStatus: "UNCLAIMED",
          },
        },
      },
    });
    trackedId = tracked.id;
    const admin = await prisma.user.create({
      data: { email: `a_${linkSuffix}@example.com`, role: "ADMIN" },
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    await prisma.creatorCompetitorProfile.deleteMany({
      where: { universalProfileId: { in: [humanId, trackedId] } },
    });
    await prisma.user.updateMany({
      where: { id: { in: [userId, adminId] } },
      data: { universalProfileId: null },
    });
    await prisma.universalProfile.deleteMany({
      where: { id: { in: [humanId, trackedId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [userId, adminId] } } });
  });

  it("admin link moves auth onto tracked creator and verifies it", async () => {
    await requestCreatorVerification({
      profileId: humanId,
      creatorSiteUrl: "https://example.com/creator",
      socialHandle: "importer",
      publicProofUrl: "https://example.com/rankiq-mention",
      claimTargetUsername: `c_${linkSuffix}`.slice(0, 24),
    });

    await approveCreatorClaimLink({
      requestingProfileId: humanId,
      targetCreatorProfileId: trackedId,
      adminUserId: adminId,
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.universalProfileId).toBe(trackedId);

    const tracked = await prisma.universalProfile.findUniqueOrThrow({
      where: { id: trackedId },
      include: { creatorCompetitor: true },
    });
    expect(tracked.profileType).toBe("CREATOR");
    expect(tracked.creatorCompetitor?.claimStatus).toBe("VERIFIED");

    const orphan = await prisma.universalProfile.findUniqueOrThrow({
      where: { id: humanId },
    });
    expect(orphan.status).toBe("SUSPENDED");
    expect(orphan.publicVisible).toBe(false);
  });
});
