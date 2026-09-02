import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/auth/errors";
import { prisma } from "@/lib/db";
import {
  CreatorError,
  evaluateProfileQualification,
  setCreatorOptIn,
  setDefaultRevealPreference,
} from "@/lib/social/creator";
import {
  grantBoardEntitlement,
  grantBoardEntitlementAsActor,
} from "@/lib/social/entitlements";
import {
  assertUserCannotWriteLedger,
  createTestLedgerEntryAsActor,
} from "@/lib/social/ledger";
import { recordBoardUnlockEvent } from "@/lib/social/unlocks";
import { followProfile, getFollowerCountsForProfiles } from "@/lib/social/follows";
import {
  canViewCurrentWeekBoard,
  canViewCurrentWeekConsensus,
} from "@/lib/timing/board-access";
import { zonedLocalToUtc } from "@/lib/timing/chicago";

const suffix = `cre${Date.now()}`;
const lockAt = zonedLocalToUtc(2026, 9, 13, 10, 0);
const noonAt = zonedLocalToUtc(2026, 9, 13, 12, 0);
const duringReveal = zonedLocalToUtc(2026, 9, 13, 11, 0);

describe("creator opt-in, entitlements, unlocks, ledger", () => {
  let humanId = "";
  let viewerId = "";
  let aiId = "";
  let seasonId = "";
  let weekId = "";
  let contestId = "";
  let otherContestId = "";

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2098,
        sport: `CRE-${suffix}`,
        active: false,
      },
    });
    seasonId = season.id;

    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 3,
        label: "Creator Test Week",
        startsAt: new Date("2098-09-09T00:00:00Z"),
        endsAt: new Date("2098-09-16T00:00:00Z"),
        status: "OPEN",
        fullLockAt: lockAt,
        revealStartsAt: lockAt,
        publicReleaseAt: noonAt,
      },
    });
    weekId = week.id;

    const contest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "QB",
        title: "Creator QB",
        rankingDepth: 10,
        status: "OPEN",
      },
    });
    contestId = contest.id;

    const other = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "RB",
        title: "Creator RB",
        rankingDepth: 10,
        status: "OPEN",
      },
    });
    otherContestId = other.id;

    const [human, viewer, ai] = await Promise.all([
      prisma.universalProfile.create({
        data: {
          username: `cre_h_${suffix}`,
          displayName: "Creator Human",
          profileType: "HUMAN",
        },
      }),
      prisma.universalProfile.create({
        data: {
          username: `cre_v_${suffix}`,
          displayName: "Creator Viewer",
          profileType: "HUMAN",
        },
      }),
      prisma.universalProfile.create({
        data: {
          username: `cre_ai_${suffix}`,
          displayName: "Creator AI",
          profileType: "AI",
        },
      }),
    ]);
    humanId = human.id;
    viewerId = viewer.id;
    aiId = ai.id;

    for (let i = 0; i < 10; i += 1) {
      const extraWeek = await prisma.week.create({
        data: {
          seasonId,
          weekNumber: 10 + i,
          label: `Graded ${i}`,
          startsAt: new Date("2098-01-01T00:00:00Z"),
          endsAt: new Date("2098-01-08T00:00:00Z"),
          status: "COMPLETE",
        },
      });
      const extraContest = await prisma.rankIQContest.create({
        data: {
          seasonId,
          weekId: extraWeek.id,
          position: "QB",
          title: `Graded QB ${i}`,
          rankingDepth: 10,
          status: "FINAL",
        },
      });
      await prisma.rankingSubmission.create({
        data: {
          contestId: extraContest.id,
          universalProfileId: humanId,
          status: "GRADED",
          normalizedScore: 80 + i,
          revealPreference: "FREE_REVEAL",
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.boardUnlockEvent.deleteMany({
      where: { creatorProfileId: { in: [humanId, aiId] } },
    });
    await prisma.creatorLedgerEntry.deleteMany({
      where: { creatorProfileId: { in: [humanId, aiId] } },
    });
    await prisma.boardEntitlement.deleteMany({
      where: { viewerProfileId: { in: [viewerId, humanId] } },
    });
    await prisma.profileFollow.deleteMany({
      where: {
        OR: [
          { followerProfileId: { in: [viewerId, humanId] } },
          { followedProfileId: { in: [viewerId, humanId] } },
        ],
      },
    });
    await prisma.creatorProfile.deleteMany({
      where: { universalProfileId: { in: [humanId, aiId] } },
    });
    await prisma.rankingSubmission.deleteMany({
      where: { universalProfileId: { in: [humanId, viewerId, aiId] } },
    });
    await prisma.rankIQContest.deleteMany({ where: { seasonId } });
    await prisma.week.deleteMany({ where: { seasonId } });
    await prisma.universalProfile.deleteMany({
      where: { id: { in: [humanId, viewerId, aiId] } },
    });
    await prisma.season.delete({ where: { id: seasonId } });
  });

  it("qualifies after minimum graded contests and supports opt-in/out", async () => {
    const before = await evaluateProfileQualification(humanId);
    expect(before.eligible).toBe(true);
    expect(before.status).toBe("ELIGIBLE");
    expect(before.gradedContestCount).toBe(10);

    await setCreatorOptIn({ profileId: humanId, enabled: true });
    const enabled = await evaluateProfileQualification(humanId);
    expect(enabled.status).toBe("ENABLED");

    await setCreatorOptIn({ profileId: humanId, enabled: false });
    const optedOut = await evaluateProfileQualification(humanId);
    expect(optedOut.status).toBe("ELIGIBLE");

    await setCreatorOptIn({ profileId: humanId, enabled: true });
  });

  it("does not allow AI or benchmark profiles to become payout creators", async () => {
    await expect(
      setCreatorOptIn({ profileId: aiId, enabled: true }),
    ).rejects.toBeInstanceOf(CreatorError);
  });

  it("sets PREMIUM_REVEAL default for enabled creators", async () => {
    await setDefaultRevealPreference({
      profileId: humanId,
      preference: "PREMIUM_REVEAL",
      applyToCurrentWeek: false,
    });
    const creator = await prisma.creatorProfile.findUniqueOrThrow({
      where: { universalProfileId: humanId },
    });
    expect(creator.defaultRevealPreference).toBe("PREMIUM_REVEAL");
  });

  it("blocks PREMIUM_REVEAL without entitlement and allows the matching one", async () => {
    const week = { fullLockAt: lockAt, revealStartsAt: lockAt, publicReleaseAt: noonAt };
    expect(
      canViewCurrentWeekBoard({
        viewer: { profileId: viewerId, isAdmin: false },
        targetProfileId: humanId,
        week,
        creatorEnabled: true,
        revealPreference: "PREMIUM_REVEAL",
        hasMatchingEntitlement: false,
        now: duringReveal,
      }),
    ).toBe(false);

    const entitlement = await grantBoardEntitlement({
      viewerProfileId: viewerId,
      entitlementType: "SINGLE_BOARD",
      contestId,
      creatorProfileId: humanId,
      weekId,
      source: "test",
    });

    expect(
      canViewCurrentWeekBoard({
        viewer: { profileId: viewerId, isAdmin: false },
        targetProfileId: humanId,
        week,
        creatorEnabled: true,
        revealPreference: "PREMIUM_REVEAL",
        hasMatchingEntitlement: true,
        now: duringReveal,
      }),
    ).toBe(true);

    const unrelated = await grantBoardEntitlement({
      viewerProfileId: viewerId,
      entitlementType: "SINGLE_BOARD",
      contestId: otherContestId,
      creatorProfileId: humanId,
      weekId,
      source: "test",
    });
    expect(unrelated.contestId).toBe(otherContestId);
    expect(entitlement.contestId).toBe(contestId);
  });

  it("records a single unlock event across duplicate refreshes", async () => {
    const first = await recordBoardUnlockEvent({
      viewerProfileId: viewerId,
      creatorProfileId: humanId,
      contestId,
      accessType: "PREMIUM_ENTITLEMENT",
      entitlementId: null,
    });
    const second = await recordBoardUnlockEvent({
      viewerProfileId: viewerId,
      creatorProfileId: humanId,
      contestId,
      accessType: "PREMIUM_ENTITLEMENT",
      entitlementId: null,
    });
    expect(first?.id).toBeTruthy();
    expect(second?.id).toBe(first?.id);
    const count = await prisma.boardUnlockEvent.count({
      where: {
        viewerProfileId: viewerId,
        creatorProfileId: humanId,
        contestId,
      },
    });
    expect(count).toBe(1);
  });

  it("blocks user ledger writes and allows admin test entries", async () => {
    expect(() => assertUserCannotWriteLedger()).toThrow(ForbiddenError);

    await expect(
      createTestLedgerEntryAsActor({
        actorRole: "USER",
        creatorProfileId: humanId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const entry = await createTestLedgerEntryAsActor({
      actorRole: "ADMIN",
      creatorProfileId: humanId,
      type: "TEST",
      status: "PENDING",
      grossAmountMinor: 0,
      creatorAmountMinor: 0,
    });
    expect(entry.creatorAmountMinor).toBe(0);
    expect(entry.status).toBe("PENDING");
  });

  it("blocks non-admin entitlement grants", async () => {
    await expect(
      grantBoardEntitlementAsActor({
        actorRole: "USER",
        viewerProfileId: viewerId,
        entitlementType: "WEEK_ALL_ACCESS",
        weekId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps consensus public after lock without auth", () => {
    expect(
      canViewCurrentWeekConsensus({
        week: {
          fullLockAt: lockAt,
          revealStartsAt: lockAt,
          publicReleaseAt: noonAt,
        },
        now: duringReveal,
      }),
    ).toBe(true);
  });

  it("exposes follower counts for discovery surfaces", async () => {
    await followProfile({
      followerProfileId: viewerId,
      followedProfileId: humanId,
    });
    const counts = await getFollowerCountsForProfiles([humanId, viewerId, aiId]);
    expect(counts.get(humanId)).toBe(1);
    expect(counts.get(viewerId)).toBe(0);
    expect(counts.get(aiId)).toBe(0);
  });
});
