import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { competitorIdentityChip } from "@/lib/profile-labels";
import {
  ProfileClaimError,
  analyzeProfileClaimCollisions,
  approveProfileClaimLink,
  requestProfileClaim,
} from "@/lib/profile-claim";
import {
  canOwnerEditProfileContent,
  isUsernameLocked,
  updateOwnedProfileContent,
} from "@/lib/profile-content";
import {
  buildPublicSocialLinks,
  resolveFeaturedLink,
} from "@/lib/profile-links";
import { getRankIQProfileView } from "@/lib/profile-stats";
import { ProfileLinkError } from "@/lib/auth/profile-link";
import { validatePublicHttpUrl } from "@/lib/creator-verification-shared";

const suffix = `boone${Date.now()}`;
const year = 3300 + (Date.now() % 600);

describe("Justin Boone Expert claim scenario", () => {
  let booneId = "";
  let booneUsername = "";
  let claimantUserId = "";
  let claimantProfileId = "";
  let adminUserId = "";
  let claimRequestId = "";
  let contestId = "";
  let weekId = "";
  let seasonId = "";
  let playerId = "";
  let booneSubmissionId = "";
  let snapshotSourceUrl = "";

  beforeAll(async () => {
    booneUsername = `justin_boone_${suffix}`.slice(0, 24);
    const boone = await prisma.universalProfile.create({
      data: {
        username: booneUsername,
        displayName: "Justin Boone",
        profileType: "BENCHMARK",
        competitorActive: true,
        publicVisible: true,
        expertSource: {
          create: {
            analystName: "Justin Boone",
            publicationName: "Yahoo Fantasy",
            sourceKind: "ANALYST",
            sourceUrl: "https://sports.yahoo.com/fantasy/",
            active: true,
          },
        },
      },
    });
    booneId = boone.id;

    const season = await prisma.season.create({
      data: {
        year,
        sport: `NFL-${suffix}`,
        active: false,
      },
    });
    seasonId = season.id;
    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 3,
        label: "Week 3",
        startsAt: new Date(`${year}-09-15T00:00:00Z`),
        endsAt: new Date(`${year}-09-22T00:00:00Z`),
        status: "COMPLETE",
        isTest: false,
      },
    });
    weekId = week.id;
    const contest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "WR",
        title: "Week 3 WR",
        rankingDepth: 10,
        status: "FINAL",
      },
    });
    contestId = contest.id;

    const player = await prisma.rankableEntry.create({
      data: {
        provider: "test",
        externalId: `boone-wr-${suffix}`,
        type: "PLAYER",
        name: "Test WR",
        shortName: "TWR",
        team: "KC",
        position: "WR",
        active: true,
      },
    });
    playerId = player.id;
    await prisma.contestEntry.create({
      data: {
        contestId,
        rankableEntryId: playerId,
        excluded: false,
        actualRank: 1,
      },
    });

    const submission = await prisma.rankingSubmission.create({
      data: {
        contestId,
        universalProfileId: booneId,
        status: "GRADED",
        normalizedScore: 88.5,
        picks: {
          create: [
            {
              rankableEntryId: playerId,
              predictedRank: 1,
              actualRank: 1,
            },
          ],
        },
      },
    });
    booneSubmissionId = submission.id;

    const admin = await prisma.user.create({
      data: {
        email: `admin_${suffix}@example.com`,
        role: "ADMIN",
      },
    });
    adminUserId = admin.id;

    snapshotSourceUrl = "https://sports.yahoo.com/fantasy/news/week-3-wr/";
    await prisma.benchmarkSnapshot.create({
      data: {
        universalProfileId: booneId,
        contestId,
        weekId,
        captureType: "MANUAL_FINAL",
        capturedAt: new Date(`${year}-09-15T12:00:00Z`),
        sourceUrl: snapshotSourceUrl,
        status: "CAPTURED",
        publicBoardAllowed: true,
        adminUserId,
      },
    });

    const claimant = await prisma.user.create({
      data: {
        email: `claimer_${suffix}@example.com`,
        role: "USER",
        name: "Claimant",
      },
    });
    claimantUserId = claimant.id;
    const human = await prisma.universalProfile.create({
      data: {
        username: `human_${suffix}`.slice(0, 24),
        displayName: "Temporary Human",
        profileType: "HUMAN",
      },
    });
    claimantProfileId = human.id;
    await prisma.user.update({
      where: { id: claimantUserId },
      data: { universalProfileId: claimantProfileId },
    });
  });

  afterAll(async () => {
    await prisma.profileClaimRequest.deleteMany({
      where: {
        OR: [
          { claimantProfileId },
          { targetProfileId: booneId },
        ],
      },
    });
    await prisma.benchmarkSnapshot.deleteMany({
      where: { universalProfileId: booneId },
    });
    await prisma.rankingPick.deleteMany({
      where: { submission: { contestId } },
    });
    await prisma.rankingSubmission.deleteMany({
      where: { contestId },
    });
    await prisma.contestEntry.deleteMany({ where: { contestId } });
    await prisma.rankIQContest.deleteMany({ where: { id: contestId } });
    await prisma.week.deleteMany({ where: { id: weekId } });
    await prisma.season.deleteMany({ where: { id: seasonId } });
    await prisma.rankableEntry.deleteMany({ where: { id: playerId } });
    await prisma.expertSourceProfile.deleteMany({
      where: { universalProfileId: booneId },
    });
    await prisma.user.updateMany({
      where: { id: { in: [claimantUserId, adminUserId] } },
      data: { universalProfileId: null },
    });
    await prisma.universalProfile.deleteMany({
      where: { id: { in: [claimantProfileId, booneId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [claimantUserId, adminUserId] } },
    });
  });

  it("1–4: HUMAN requests Boone claim; Admin must approve (no auto-approve)", async () => {
    const beforeView = await getRankIQProfileView(booneUsername, {
      allowPrivate: true,
    });
    expect(beforeView?.hasAuthUser).toBe(false);
    expect(beforeView?.ownershipVerified).toBe(false);

    expect(
      competitorIdentityChip({
        profileType: "BENCHMARK",
        expertPublisher: "Yahoo Fantasy",
      }).label,
    ).toBe("EXPERT · Yahoo Fantasy");

    const claim = await requestProfileClaim({
      claimantUserId,
      claimantProfileId,
      targetUsername: booneUsername,
      creatorSiteUrl: "https://example.com/justin-boone",
      socialHandle: "@justinboone",
      publicProofUrl: "https://example.com/rankiq-proof",
      claimNote: "I am Justin Boone",
    });
    claimRequestId = claim.id;
    expect(claim.status).toBe("REQUESTED");

    const stillUnowned = await prisma.universalProfile.findUniqueOrThrow({
      where: { id: booneId },
      include: { authUser: true },
    });
    expect(stillUnowned.authUser).toBeNull();
    expect(stillUnowned.ownershipVerifiedAt).toBeNull();
    expect(stillUnowned.profileType).toBe("BENCHMARK");
  });

  it("5–10: Admin approval links User to existing Boone profile without rewrite", async () => {
    const beforeSubs = await prisma.rankingSubmission.findMany({
      where: { universalProfileId: booneId },
      select: { id: true, normalizedScore: true },
    });
    expect(beforeSubs.map((s) => s.id)).toEqual([booneSubmissionId]);

    const result = await approveProfileClaimLink({
      claimRequestId,
      adminUserId,
    });

    expect(result.targetProfileId).toBe(booneId);
    expect(result.targetProfileType).toBe("BENCHMARK");
    expect(result.username).toBe(booneUsername);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: claimantUserId },
    });
    expect(user.universalProfileId).toBe(booneId);

    const boone = await prisma.universalProfile.findUniqueOrThrow({
      where: { id: booneId },
    });
    expect(boone.id).toBe(booneId);
    expect(boone.profileType).toBe("BENCHMARK");
    expect(boone.username).toBe(booneUsername);
    expect(boone.ownershipVerifiedAt).not.toBeNull();

    const afterSubs = await prisma.rankingSubmission.findMany({
      where: { universalProfileId: booneId },
      select: { id: true, normalizedScore: true },
    });
    expect(afterSubs).toEqual(beforeSubs);

    expect(
      competitorIdentityChip({
        profileType: boone.profileType,
        expertPublisher: "Yahoo Fantasy",
      }).label,
    ).toBe("EXPERT · Yahoo Fantasy");

    const shell = await prisma.universalProfile.findUniqueOrThrow({
      where: { id: claimantProfileId },
    });
    expect(shell.status).toBe("SUSPENDED");
    expect(shell.publicVisible).toBe(false);

    // Claimed → Verified; claim CTA inputs now false.
    const afterView = await getRankIQProfileView(booneUsername, {
      allowPrivate: true,
    });
    expect(afterView?.hasAuthUser).toBe(true);
    expect(afterView?.ownershipVerified).toBe(true);
    expect(afterView?.profileType).toBe("BENCHMARK");
  });

  it("second claim on an owned profile is rejected", async () => {
    const other = await prisma.user.create({
      data: { email: `other_${suffix}@example.com`, role: "USER" },
    });
    const otherHuman = await prisma.universalProfile.create({
      data: {
        username: `oth_${suffix}`.slice(0, 24),
        displayName: "Other",
        profileType: "HUMAN",
      },
    });
    await prisma.user.update({
      where: { id: other.id },
      data: { universalProfileId: otherHuman.id },
    });
    await expect(
      requestProfileClaim({
        claimantUserId: other.id,
        claimantProfileId: otherHuman.id,
        targetUsername: booneUsername,
        creatorSiteUrl: "https://example.com/x",
        socialHandle: "@x",
        publicProofUrl: "https://example.com/y",
      }),
    ).rejects.toBeInstanceOf(ProfileClaimError);
    // Cannot claim on behalf of another user's profile id.
    await expect(
      requestProfileClaim({
        claimantUserId: other.id,
        claimantProfileId,
        targetUsername: booneUsername,
        creatorSiteUrl: "https://example.com/x",
        socialHandle: "@x",
        publicProofUrl: "https://example.com/y",
      }),
    ).rejects.toBeInstanceOf(ProfileClaimError);
    await prisma.user.update({
      where: { id: other.id },
      data: { universalProfileId: null },
    });
    await prisma.universalProfile.delete({ where: { id: otherHuman.id } });
    await prisma.user.delete({ where: { id: other.id } });
  });

  it("11–12: owner can edit presentation; cannot rewrite weekly sourceUrl", async () => {
    const updated = await updateOwnedProfileContent({
      userId: claimantUserId,
      displayName: "Justin Boone",
      headline: "Fantasy Football Analyst",
      bio: "Yahoo Fantasy analyst",
      affiliation: "Yahoo Fantasy",
      websiteUrl: "https://sports.yahoo.com/fantasy/",
      xUrl: "https://x.com/justinboone",
      featuredLinkTitle: "Week 4 Rankings Breakdown",
      featuredLinkUrl: "https://example.com/week-4-breakdown",
    });
    expect(updated.headline).toBe("Fantasy Football Analyst");
    expect(updated.xUrl).toBe("https://x.com/justinboone");
    expect(updated.featuredLinkTitle).toBe("Week 4 Rankings Breakdown");

    const snap = await prisma.benchmarkSnapshot.findFirstOrThrow({
      where: { universalProfileId: booneId, contestId },
    });
    expect(snap.sourceUrl).toBe(snapshotSourceUrl);

    // updateOwnedProfileContent has no sourceUrl field — provenance stays RankEyeQ-owned.
    expect(canOwnerEditProfileContent("BENCHMARK")).toBe(true);
    expect(canOwnerEditProfileContent("AI")).toBe(false);

    // Public URL stays stable: username locked for claimed Expert.
    expect(isUsernameLocked(updated)).toBe(true);
    await expect(
      updateOwnedProfileContent({
        userId: claimantUserId,
        username: "boone_renamed",
      }),
    ).rejects.toBeInstanceOf(ProfileLinkError);

    // Competitive rows untouched by presentation edits.
    const sub = await prisma.rankingSubmission.findUniqueOrThrow({
      where: { id: booneSubmissionId },
    });
    expect(sub.normalizedScore).toBe(88.5);
    expect(sub.universalProfileId).toBe(booneId);
    const boone = await prisma.universalProfile.findUniqueOrThrow({
      where: { id: booneId },
    });
    expect(boone.profileType).toBe("BENCHMARK");
    expect(boone.username).toBe(booneUsername);
  });

  it("weekly source URL is RankEyeQ provenance and unchanged by owner edits", async () => {
    // Owner update input has no sourceUrl key; extra keys are ignored by the allowlist.
    await updateOwnedProfileContent({
      userId: claimantUserId,
      ...({ sourceUrl: "https://evil.example.com" } as object),
      headline: "Still Analyst",
    } as Parameters<typeof updateOwnedProfileContent>[0]);
    const snap = await prisma.benchmarkSnapshot.findFirstOrThrow({
      where: { universalProfileId: booneId, contestId },
    });
    expect(snap.sourceUrl).toBe(snapshotSourceUrl);
    const expertSource = await prisma.expertSourceProfile.findUniqueOrThrow({
      where: { universalProfileId: booneId },
    });
    expect(expertSource.sourceUrl).toBe("https://sports.yahoo.com/fantasy/");
  });
});

describe("Expert claim collisions require Admin acknowledgment", () => {
  const cSuffix = `col${Date.now()}`;
  const cYear = 3400 + (Date.now() % 500);
  let expertId = "";
  let humanId = "";
  let userId = "";
  let adminId = "";
  let contestId = "";
  let weekId = "";
  let seasonId = "";
  let playerId = "";
  let claimId = "";

  beforeAll(async () => {
    const expert = await prisma.universalProfile.create({
      data: {
        username: `exp_${cSuffix}`.slice(0, 24),
        displayName: "Expert Target",
        profileType: "BENCHMARK",
        expertSource: {
          create: {
            analystName: "Expert Target",
            publicationName: "Test Pub",
            sourceKind: "ANALYST",
            active: true,
          },
        },
      },
    });
    expertId = expert.id;

    const user = await prisma.user.create({
      data: { email: `col_${cSuffix}@example.com`, role: "USER" },
    });
    userId = user.id;
    const human = await prisma.universalProfile.create({
      data: {
        username: `hm_${cSuffix}`.slice(0, 24),
        displayName: "Human With Boards",
        profileType: "HUMAN",
      },
    });
    humanId = human.id;
    await prisma.user.update({
      where: { id: userId },
      data: { universalProfileId: humanId },
    });

    const admin = await prisma.user.create({
      data: { email: `acol_${cSuffix}@example.com`, role: "ADMIN" },
    });
    adminId = admin.id;

    const season = await prisma.season.create({
      data: { year: cYear, sport: `NFL-${cSuffix}`, active: false },
    });
    seasonId = season.id;
    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: "W1",
        startsAt: new Date(`${cYear}-09-01T00:00:00Z`),
        endsAt: new Date(`${cYear}-09-08T00:00:00Z`),
        status: "COMPLETE",
      },
    });
    weekId = week.id;
    const contest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "QB",
        title: "QB",
        rankingDepth: 10,
        status: "FINAL",
      },
    });
    contestId = contest.id;
    const player = await prisma.rankableEntry.create({
      data: {
        provider: "test",
        externalId: `col-qb-${cSuffix}`,
        type: "PLAYER",
        name: "Col QB",
        shortName: "CQB",
        team: "MIN",
        position: "QB",
        active: true,
      },
    });
    playerId = player.id;

    await prisma.rankingSubmission.create({
      data: {
        contestId,
        universalProfileId: expertId,
        status: "GRADED",
        normalizedScore: 70,
      },
    });
    await prisma.rankingSubmission.create({
      data: {
        contestId,
        universalProfileId: humanId,
        status: "GRADED",
        normalizedScore: 50,
      },
    });

    const claim = await requestProfileClaim({
      claimantUserId: userId,
      claimantProfileId: humanId,
      targetUsername: `exp_${cSuffix}`.slice(0, 24),
      creatorSiteUrl: "https://example.com/site",
      socialHandle: "expert",
      publicProofUrl: "https://example.com/proof",
    });
    claimId = claim.id;
  });

  afterAll(async () => {
    await prisma.profileClaimRequest.deleteMany({
      where: { id: claimId },
    });
    await prisma.rankingSubmission.deleteMany({ where: { contestId } });
    await prisma.rankIQContest.deleteMany({ where: { id: contestId } });
    await prisma.week.deleteMany({ where: { id: weekId } });
    await prisma.season.deleteMany({ where: { id: seasonId } });
    await prisma.rankableEntry.deleteMany({ where: { id: playerId } });
    await prisma.expertSourceProfile.deleteMany({
      where: { universalProfileId: expertId },
    });
    await prisma.user.updateMany({
      where: { id: { in: [userId, adminId] } },
      data: { universalProfileId: null },
    });
    await prisma.universalProfile.deleteMany({
      where: { id: { in: [humanId, expertId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [userId, adminId] } } });
  });

  it("blocks approval until collisions are acknowledged; then preserves both histories", async () => {
    const analysis = await analyzeProfileClaimCollisions({
      claimantProfileId: humanId,
      targetProfileId: expertId,
    });
    expect(analysis.collisions).toHaveLength(1);

    await expect(
      approveProfileClaimLink({
        claimRequestId: claimId,
        adminUserId: adminId,
      }),
    ).rejects.toBeInstanceOf(ProfileClaimError);

    await approveProfileClaimLink({
      claimRequestId: claimId,
      adminUserId: adminId,
      acknowledgeCollisions: true,
    });

    const expertSubs = await prisma.rankingSubmission.count({
      where: { universalProfileId: expertId },
    });
    const humanSubs = await prisma.rankingSubmission.count({
      where: { universalProfileId: humanId },
    });
    expect(expertSubs).toBe(1);
    expect(humanSubs).toBe(1);

    const expert = await prisma.universalProfile.findUniqueOrThrow({
      where: { id: expertId },
    });
    expect(expert.profileType).toBe("BENCHMARK");
  });
});

describe("profile content presentation helpers", () => {
  it("hides empty social fields and shows populated ones", () => {
    expect(
      buildPublicSocialLinks({
        websiteUrl: null,
        xUrl: "https://x.com/a",
        youtubeUrl: "  ",
        instagramUrl: null,
      }),
    ).toEqual([{ kind: "x", label: "X", url: "https://x.com/a" }]);
    expect(buildPublicSocialLinks({})).toEqual([]);
  });

  it("never renders unsafe stored links", () => {
    expect(
      buildPublicSocialLinks({ websiteUrl: "javascript:alert(1)" }),
    ).toEqual([]);
  });

  it("Featured CTA only when title + safe URL both exist", () => {
    expect(
      resolveFeaturedLink({ featuredLinkTitle: "T", featuredLinkUrl: null }),
    ).toBeNull();
    expect(
      resolveFeaturedLink({
        featuredLinkTitle: null,
        featuredLinkUrl: "https://example.com",
      }),
    ).toBeNull();
    expect(
      resolveFeaturedLink({
        featuredLinkTitle: "T",
        featuredLinkUrl: "data:text/html,x",
      }),
    ).toBeNull();
    expect(
      resolveFeaturedLink({
        featuredLinkTitle: "Week 4 Breakdown",
        featuredLinkUrl: "https://example.com/w4",
      }),
    ).toEqual({ title: "Week 4 Breakdown", url: "https://example.com/w4" });
  });

  it("HUMAN usernames stay editable (existing behavior)", () => {
    expect(isUsernameLocked({ profileType: "HUMAN" })).toBe(false);
    expect(
      isUsernameLocked({ profileType: "CREATOR", ownershipVerifiedAt: null }),
    ).toBe(false);
    expect(isUsernameLocked({ profileType: "BENCHMARK" })).toBe(true);
  });

  it("rejects unsafe URLs", () => {
    expect(validatePublicHttpUrl("javascript:alert(1)").ok).toBe(false);
    expect(validatePublicHttpUrl("data:text/html,hi").ok).toBe(false);
    expect(validatePublicHttpUrl("https://example.com/ok").ok).toBe(true);
  });

  it("AI cannot self-claim or edit presentation", async () => {
    const s = `ai${Date.now()}`;
    const user = await prisma.user.create({
      data: { email: `${s}@example.com`, role: "USER" },
    });
    const ai = await prisma.universalProfile.create({
      data: {
        username: `ai_${s}`.slice(0, 24),
        displayName: "AI Bot",
        profileType: "AI",
      },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { universalProfileId: ai.id },
    });
    await expect(
      updateOwnedProfileContent({ userId: user.id, headline: "x" }),
    ).rejects.toBeInstanceOf(ProfileLinkError);
    await expect(
      requestProfileClaim({
        claimantUserId: user.id,
        claimantProfileId: ai.id,
        targetUsername: "anything",
        creatorSiteUrl: "https://example.com",
        socialHandle: "@x",
        publicProofUrl: "https://example.com/p",
      }),
    ).rejects.toBeInstanceOf(ProfileClaimError);
    await prisma.user.update({
      where: { id: user.id },
      data: { universalProfileId: null },
    });
    await prisma.universalProfile.delete({ where: { id: ai.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("owner content update rejects unsafe featured URL", async () => {
    const suffixLocal = `cnt${Date.now()}`;
    const user = await prisma.user.create({
      data: {
        email: `${suffixLocal}@example.com`,
        role: "USER",
      },
    });
    const profile = await prisma.universalProfile.create({
      data: {
        username: `cnt_${suffixLocal}`.slice(0, 24),
        displayName: "Content Human",
        profileType: "HUMAN",
      },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { universalProfileId: profile.id },
    });

    await expect(
      updateOwnedProfileContent({
        userId: user.id,
        featuredLinkTitle: "Bad",
        featuredLinkUrl: "javascript:alert(1)",
      }),
    ).rejects.toBeInstanceOf(ProfileLinkError);

    // Unrelated user cannot edit by guessing profile id — updates are keyed off session user.
    const other = await prisma.user.create({
      data: { email: `other_${suffixLocal}@example.com`, role: "USER" },
    });
    await expect(
      updateOwnedProfileContent({
        userId: other.id,
        headline: "Hijack",
      }),
    ).rejects.toBeInstanceOf(ProfileLinkError);

    await prisma.user.update({
      where: { id: user.id },
      data: { universalProfileId: null },
    });
    await prisma.universalProfile.delete({ where: { id: profile.id } });
    await prisma.user.deleteMany({
      where: { id: { in: [user.id, other.id] } },
    });
  });
});
