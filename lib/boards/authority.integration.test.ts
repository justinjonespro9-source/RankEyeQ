import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canSubmitFromRankingWorkspace } from "@/lib/auth/participation";
import {
  captureBenchmarkSnapshot,
  markBenchmarkNotAvailable,
} from "@/lib/benchmarks/snapshots";
import {
  CAPTURED_BOARD_WORKSPACE_MESSAGE,
  OWNER_MANAGED_CAPTURE_MESSAGE,
} from "@/lib/boards/authority";
import { createCreatorCompetitor } from "@/lib/creator-identity";
import { prisma } from "@/lib/db";
import { gradeContest } from "@/lib/grading";
import { approveProfileClaimLink, requestProfileClaim } from "@/lib/profile-claim";
import { getPublicProfileBoard } from "@/lib/public-board";
import {
  saveSubmissionPicks,
  submitRanking,
} from "@/lib/submissions";
import { zonedLocalToUtc } from "@/lib/timing/chicago";
import { computeNflTimingWindows } from "@/lib/timing/week-windows";

const suffix = `auth${Date.now().toString(36)}`;
const seasonYear = 3950 + (Date.now() % 40);
const thursdayKickoff = zonedLocalToUtc(2026, 9, 10, 19, 15);
const sundayKickoff = zonedLocalToUtc(2026, 9, 13, 12, 0);
const timing = computeNflTimingWindows(thursdayKickoff, sundayKickoff);
const now = zonedLocalToUtc(2026, 9, 10, 12, 0);
const admin = { profileId: null, isAdmin: true };

describe("board authority / capture-overwrite protection", () => {
  let seasonId = "";
  let weekId = "";
  let rbId = "";
  let qbId = "";
  let teId = "";
  let adminUserId = "";
  const rb: string[] = [];
  const qb: string[] = [];
  const te: string[] = [];
  const profileIds: string[] = [];
  const userIds: string[] = [];
  const p = {
    human: "",
    claimant: "",
    creatorClaimed: "",
    creatorClaimedUsername: "",
    creatorTracked: "",
    creatorTrackedUsername: "",
    creatorLegacyOwner: "",
    creatorLegacyCaptured: "",
    creatorOwnerNoUser: "",
    expert: "",
    expertClaimed: "",
    ai: "",
  };

  async function profile(profileType: "HUMAN" | "BENCHMARK" | "AI", key: string) {
    const row = await prisma.universalProfile.create({
      data: { username: `${key}_${suffix}`.slice(0, 30), displayName: key, profileType },
    });
    profileIds.push(row.id);
    return row.id;
  }
  async function creator(key: string) {
    const row = await createCreatorCompetitor({
      personName: `${key} ${suffix}`,
      brandName: `${key} Channel`,
      username: `${key}_${suffix}`.slice(0, 30),
    });
    profileIds.push(row.id);
    return row;
  }
  async function linkUser(profileId: string, key: string) {
    const user = await prisma.user.create({
      data: { email: `${key}-${suffix}@rankiq.local`, universalProfileId: profileId },
    });
    userIds.push(user.id);
    return user.id;
  }
  function capturePicks(entryIds: string[]) {
    return entryIds.map((rankableEntryId, index) => ({
      sourceRank: index + 1,
      rawName: `Player ${index + 1}`,
      rankableEntryId,
      rankIqRank: index + 1,
      excluded: false,
      exclusionReason: null,
      issue: null,
      selected: true,
    }));
  }
  function capture(profileId: string, contestId: string, entryIds: string[]) {
    return captureBenchmarkSnapshot({
      contestId,
      universalProfileId: profileId,
      adminUserId,
      captureType: "MANUAL_FINAL",
      capturedAt: now,
      sourceUrl: `https://example.com/rankings/${profileId}`,
      picks: capturePicks(entryIds),
      commitOfficial: true,
    });
  }
  async function board(contestId: string, universalProfileId: string) {
    return prisma.rankingSubmission.findUnique({
      where: { contestId_universalProfileId: { contestId, universalProfileId } },
      include: { picks: { orderBy: { predictedRank: "asc" } } },
    });
  }
  async function snapshotCount(universalProfileId: string) {
    return prisma.benchmarkSnapshot.count({ where: { universalProfileId, weekId } });
  }

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: { year: seasonYear, sport: "NFL", active: false },
    });
    seasonId = season.id;
    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: "Authority Week",
        startsAt: thursdayKickoff,
        endsAt: sundayKickoff,
        status: "OPEN",
        isTest: true,
        rankingsOpenAt: timing.rankingsOpenAt,
        fullLockAt: timing.fullLockAt,
        revealStartsAt: timing.revealStartsAt,
        publicReleaseAt: timing.publicReleaseAt,
      },
    });
    weekId = week.id;
    const game = await prisma.nflGame.create({
      data: {
        provider: "test",
        externalId: `auth-game-${suffix}`,
        seasonId,
        weekId,
        seasonYear,
        weekNumber: 1,
        homeTeam: "OPP",
        awayTeam: "TST",
        startsAt: sundayKickoff,
      },
    });
    const contest = async (position: "RB" | "QB" | "TE", reserveCount: number) =>
      (
        await prisma.rankIQContest.create({
          data: {
            seasonId,
            weekId,
            position,
            title: `Authority ${position}`,
            rankingDepth: 4,
            reserveCount,
            status: "OPEN",
          },
        })
      ).id;
    rbId = await contest("RB", 2);
    qbId = await contest("QB", 2);
    teId = await contest("TE", 0);
    for (const [contestId, position, list] of [
      [rbId, "RB", rb],
      [qbId, "QB", qb],
      [teId, "TE", te],
    ] as const) {
      for (let i = 1; i <= 8; i += 1) {
        const entry = await prisma.rankableEntry.create({
          data: {
            provider: "test",
            externalId: `auth-${suffix}-${position}-${i}`,
            type: "PLAYER",
            name: `${position} Player ${i}`,
            shortName: `${position}${i}`,
            team: "TST",
            opponent: "@ OPP",
            position,
            gameStartsAt: sundayKickoff,
            gameId: game.id,
          },
        });
        await prisma.contestEntry.create({
          data: { contestId, rankableEntryId: entry.id, gameId: game.id },
        });
        list.push(entry.id);
      }
    }

    const adminUser = await prisma.user.create({
      data: { email: `auth-admin-${suffix}@rankiq.local`, role: "ADMIN" },
    });
    adminUserId = adminUser.id;
    userIds.push(adminUserId);

    p.human = await profile("HUMAN", "human");
    await linkUser(p.human, "human");
    p.claimant = await profile("HUMAN", "claimant");
    const claimed = await creator("claimedcr");
    p.creatorClaimed = claimed.id;
    p.creatorClaimedUsername = claimed.username;
    const tracked = await creator("trackedcr");
    p.creatorTracked = tracked.id;
    p.creatorTrackedUsername = tracked.username;
    p.creatorLegacyOwner = (await creator("legacyown")).id;
    p.creatorLegacyCaptured = (await creator("legacycap")).id;
    p.creatorOwnerNoUser = (await creator("ownernouser")).id;
    p.expert = await profile("BENCHMARK", "expert");
    p.expertClaimed = await profile("BENCHMARK", "expertcl");
    await linkUser(p.expertClaimed, "expertcl");
    p.ai = await profile("AI", "aibot");
  });

  afterAll(async () => {
    const contestIds = [rbId, qbId, teId].filter(Boolean);
    await prisma.rankingPick.deleteMany({ where: { submission: { contestId: { in: contestIds } } } });
    await prisma.rankingSubmission.deleteMany({ where: { contestId: { in: contestIds } } });
    await prisma.benchmarkSnapshotPick.deleteMany({ where: { snapshot: { weekId } } });
    await prisma.benchmarkSnapshot.deleteMany({ where: { weekId } });
    await prisma.contestEntry.deleteMany({ where: { contestId: { in: contestIds } } });
    await prisma.rankIQContest.deleteMany({ where: { id: { in: contestIds } } });
    await prisma.nflGame.deleteMany({ where: { weekId } });
    await prisma.week.deleteMany({ where: { id: weekId } });
    await prisma.season.deleteMany({ where: { id: seasonId } });
    await prisma.rankableEntry.deleteMany({
      where: { externalId: { startsWith: `auth-${suffix}-` } },
    });
    await prisma.profileClaimRequest.deleteMany({
      where: { targetProfileId: { in: profileIds } },
    });
    await prisma.creatorCompetitorProfile.deleteMany({
      where: { universalProfileId: { in: profileIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.universalProfile.deleteMany({ where: { id: { in: profileIds } } });
  });

  it("1: HUMAN workspace save stamps OWNER_AUTHORED", async () => {
    await saveSubmissionPicks({
      contestId: rbId,
      universalProfileId: p.human,
      rankedEntryIds: rb.slice(0, 4),
      authority: "OWNER_AUTHORED",
      now,
    });
    expect((await board(rbId, p.human))?.authority).toBe("OWNER_AUTHORED");
  });

  it("3 + 4: captured CREATOR and BENCHMARK boards stamp RANKEYEQ_CAPTURED", async () => {
    for (const id of [p.creatorTracked, p.expert]) {
      const result = await capture(id, rbId, rb.slice(0, 4));
      expect(result.official).toBe(true);
      const row = await board(rbId, id);
      expect(row?.authority).toBe("RANKEYEQ_CAPTURED");
      expect(row?.picks.every((pick) => pick.sourceRank != null)).toBe(true);
    }
  });

  it("5: AI/system writes stamp SYSTEM_OPERATED; cross-type authority is refused", async () => {
    await saveSubmissionPicks({
      contestId: rbId,
      universalProfileId: p.ai,
      rankedEntryIds: rb.slice(0, 4),
      authority: "SYSTEM_OPERATED",
      now,
    });
    expect((await board(rbId, p.ai))?.authority).toBe("SYSTEM_OPERATED");
    await expect(
      saveSubmissionPicks({
        contestId: qbId,
        universalProfileId: p.ai,
        rankedEntryIds: qb.slice(0, 4),
        authority: "OWNER_AUTHORED",
        now,
      }),
    ).rejects.toThrow("This profile cannot author boards from the ranking workspace.");
    await expect(
      saveSubmissionPicks({
        contestId: qbId,
        universalProfileId: p.human,
        rankedEntryIds: qb.slice(0, 4),
        authority: "SYSTEM_OPERATED",
        now,
      }),
    ).rejects.toThrow("System-operated boards require an AI profile.");
    // Captured BENCHMARK boards never become SYSTEM_OPERATED.
    expect((await board(rbId, p.expert))?.authority).toBe("RANKEYEQ_CAPTURED");
  });

  it("6: admin capture against an OWNER_AUTHORED board is refused and writes nothing", async () => {
    await prisma.rankingSubmission.create({
      data: {
        contestId: rbId,
        universalProfileId: p.creatorOwnerNoUser,
        status: "SUBMITTED",
        authority: "OWNER_AUTHORED",
        picks: {
          create: rb.slice(4, 8).map((rankableEntryId, index) => ({
            rankableEntryId,
            predictedRank: index + 1,
          })),
        },
      },
    });
    const before = await board(rbId, p.creatorOwnerNoUser);
    await expect(capture(p.creatorOwnerNoUser, rbId, rb.slice(0, 4))).rejects.toThrow(
      OWNER_MANAGED_CAPTURE_MESSAGE,
    );
    const after = await board(rbId, p.creatorOwnerNoUser);
    expect(after?.authority).toBe("OWNER_AUTHORED");
    expect(after?.status).toBe(before?.status);
    expect(after?.picks.map((pick) => [pick.rankableEntryId, pick.predictedRank, pick.sourceRank])).toEqual(
      before?.picks.map((pick) => [pick.rankableEntryId, pick.predictedRank, pick.sourceRank]),
    );
    expect(await snapshotCount(p.creatorOwnerNoUser)).toBe(0);
  });

  it("7: NOT_AVAILABLE against an OWNER_AUTHORED board is refused; legacy hide flags never restrict it", async () => {
    await expect(
      markBenchmarkNotAvailable({
        contestId: rbId,
        universalProfileId: p.creatorOwnerNoUser,
        adminUserId,
      }),
    ).rejects.toThrow(OWNER_MANAGED_CAPTURE_MESSAGE);
    expect(await snapshotCount(p.creatorOwnerNoUser)).toBe(0);

    // Read-side defense: a pre-existing NOT_AVAILABLE row cannot hide the owner board.
    await prisma.benchmarkSnapshot.create({
      data: {
        universalProfileId: p.creatorOwnerNoUser,
        contestId: rbId,
        weekId,
        captureType: "MANUAL_FINAL",
        capturedAt: now,
        status: "NOT_AVAILABLE",
        publicBoardAllowed: false,
        adminUserId,
      },
    });
    const owner = await prisma.universalProfile.findUniqueOrThrow({
      where: { id: p.creatorOwnerNoUser },
    });
    const view = await getPublicProfileBoard({
      username: owner.username,
      weekNumber: 1,
      position: "RB",
      viewer: admin,
      seasonYear,
      now,
      recordUnlock: false,
    });
    expect(view?.publicBoardRestricted).toBe(false);
    expect(view?.captureAttribution).toBeNull();
  });

  it("8: legacy/null owner-authored board → capture refused via sourceRank inference", async () => {
    await prisma.rankingSubmission.create({
      data: {
        contestId: rbId,
        universalProfileId: p.creatorLegacyOwner,
        status: "SUBMITTED",
        picks: {
          create: rb.slice(0, 4).map((rankableEntryId, index) => ({
            rankableEntryId,
            predictedRank: index + 1,
          })),
        },
      },
    });
    await expect(capture(p.creatorLegacyOwner, rbId, rb.slice(4, 8))).rejects.toThrow(
      OWNER_MANAGED_CAPTURE_MESSAGE,
    );
    const row = await board(rbId, p.creatorLegacyOwner);
    expect(row?.authority).toBeNull();
    expect(row?.picks.map((pick) => pick.rankableEntryId)).toEqual(rb.slice(0, 4));
  });

  it("9: legacy/null captured board → capture still works and is stamped", async () => {
    await prisma.rankingSubmission.create({
      data: {
        contestId: rbId,
        universalProfileId: p.creatorLegacyCaptured,
        status: "LOCKED",
        picks: {
          create: rb.slice(0, 4).map((rankableEntryId, index) => ({
            rankableEntryId,
            predictedRank: index + 1,
            sourceRank: index + 1,
          })),
        },
      },
    });
    const result = await capture(p.creatorLegacyCaptured, rbId, rb.slice(4, 8));
    expect(result.official).toBe(true);
    const row = await board(rbId, p.creatorLegacyCaptured);
    expect(row?.authority).toBe("RANKEYEQ_CAPTURED");
    expect(row?.picks.map((pick) => pick.rankableEntryId)).toEqual(rb.slice(4, 8));
  });

  it("10 + 2: claiming keeps the captured board captured; the owner authors only new contests", async () => {
    await capture(p.creatorClaimed, rbId, rb.slice(0, 4));
    // Pre-claim source evidence on QB (no board): must survive and stay non-provenance later.
    await prisma.benchmarkSnapshot.create({
      data: {
        universalProfileId: p.creatorClaimed,
        contestId: qbId,
        weekId,
        captureType: "THURSDAY",
        capturedAt: now,
        sourceUrl: "https://example.com/pre-claim-qb",
        status: "CAPTURED",
        publicBoardAllowed: true,
        adminUserId,
      },
    });
    const beforeClaim = await board(rbId, p.creatorClaimed);

    const claimantUserId = await linkUser(p.claimant, "claimant");
    const request = await requestProfileClaim({
      claimantUserId,
      claimantProfileId: p.claimant,
      targetUsername: p.creatorClaimedUsername,
      creatorSiteUrl: "https://example.com/creator-site",
      socialHandle: "@claimedcreator",
      publicProofUrl: "https://example.com/proof",
    });
    await approveProfileClaimLink({ claimRequestId: request.id, adminUserId });

    const afterClaim = await board(rbId, p.creatorClaimed);
    expect(afterClaim?.authority).toBe("RANKEYEQ_CAPTURED");
    expect(afterClaim?.updatedAt.getTime()).toBe(beforeClaim?.updatedAt.getTime());

    // First owner save against the captured board is refused (no implicit takeover).
    await expect(
      saveSubmissionPicks({
        contestId: rbId,
        universalProfileId: p.creatorClaimed,
        rankedEntryIds: rb.slice(4, 8),
        authority: "OWNER_AUTHORED",
        now,
      }),
    ).rejects.toThrow(CAPTURED_BOARD_WORKSPACE_MESSAGE);
    const untouched = await board(rbId, p.creatorClaimed);
    expect(untouched?.authority).toBe("RANKEYEQ_CAPTURED");
    expect(untouched?.status).toBe(beforeClaim?.status);
    expect(untouched?.picks.map((pick) => [pick.rankableEntryId, pick.sourceRank])).toEqual(
      beforeClaim?.picks.map((pick) => [pick.rankableEntryId, pick.sourceRank]),
    );

    // The still-captured contest remains capture-managed (corrections allowed).
    await expect(capture(p.creatorClaimed, rbId, rb.slice(1, 5))).resolves.toMatchObject({
      official: true,
    });
    expect((await board(rbId, p.creatorClaimed))?.authority).toBe("RANKEYEQ_CAPTURED");

    // New contest: owner-managed — capture refused, workspace save → OWNER_AUTHORED.
    await expect(capture(p.creatorClaimed, qbId, qb.slice(0, 4))).rejects.toThrow(
      OWNER_MANAGED_CAPTURE_MESSAGE,
    );
    await saveSubmissionPicks({
      contestId: qbId,
      universalProfileId: p.creatorClaimed,
      rankedEntryIds: qb.slice(0, 4),
      authority: "OWNER_AUTHORED",
      now,
    });
    expect((await board(qbId, p.creatorClaimed))?.authority).toBe("OWNER_AUTHORED");
    await expect(
      markBenchmarkNotAvailable({ contestId: qbId, universalProfileId: p.creatorClaimed, adminUserId }),
    ).rejects.toThrow(OWNER_MANAGED_CAPTURE_MESSAGE);
    // Historical evidence is never deleted.
    expect(
      await prisma.benchmarkSnapshot.count({
        where: { universalProfileId: p.creatorClaimed, contestId: qbId, status: "CAPTURED" },
      }),
    ).toBe(1);
  });

  it("11: claimed BENCHMARK stays capture-managed and cannot use the ranking workspace", async () => {
    expect(canSubmitFromRankingWorkspace("BENCHMARK")).toBe(false);
    await expect(capture(p.expertClaimed, rbId, rb.slice(0, 4))).resolves.toMatchObject({
      official: true,
    });
    expect((await board(rbId, p.expertClaimed))?.authority).toBe("RANKEYEQ_CAPTURED");
    await expect(
      saveSubmissionPicks({
        contestId: qbId,
        universalProfileId: p.expertClaimed,
        rankedEntryIds: qb.slice(0, 4),
        authority: "OWNER_AUTHORED",
        now,
      }),
    ).rejects.toThrow("This profile cannot author boards from the ranking workspace.");
  });

  it("12: owner-authored public board shows no captured-source provenance", async () => {
    const view = await getPublicProfileBoard({
      username: p.creatorClaimedUsername,
      weekNumber: 1,
      position: "QB",
      viewer: admin,
      seasonYear,
      now,
      recordUnlock: false,
    });
    expect(view?.submissionStatus).toBeTruthy();
    expect(view?.captureAttribution).toBeNull();
    expect(view?.weeklySourceUrl).toBeNull();
    expect(view?.capturedAt).toBeNull();
    expect(view?.publicBoardRestricted).toBe(false);
  });

  it("13: captured public board keeps captured provenance + source URL", async () => {
    const view = await getPublicProfileBoard({
      username: p.creatorTrackedUsername,
      weekNumber: 1,
      position: "RB",
      viewer: admin,
      seasonYear,
      now,
      recordUnlock: false,
    });
    expect(view?.captureAttribution).toBe("Source ranking captured by RankEYEQ");
    expect(view?.weeklySourceUrl).toBe(`https://example.com/rankings/${p.creatorTracked}`);
    expect(view?.capturedAt).not.toBeNull();

    // Captured provenance also persists for the claimed Creator's still-captured contest.
    const claimedRb = await getPublicProfileBoard({
      username: p.creatorClaimedUsername,
      weekNumber: 1,
      position: "RB",
      viewer: admin,
      seasonYear,
      now,
      recordUnlock: false,
    });
    expect(claimedRb?.captureAttribution).toBe("Source ranking captured by RankEYEQ");
  });

  it("14: authority has zero effect on grading, scoring, reserves, freezes and locks", async () => {
    const order = te.slice(0, 4);
    await submitRanking({
      contestId: teId,
      universalProfileId: p.human,
      rankedEntryIds: order,
      authority: "OWNER_AUTHORED",
      now,
    });
    await submitRanking({
      contestId: teId,
      universalProfileId: p.ai,
      rankedEntryIds: order,
      authority: "SYSTEM_OPERATED",
      now,
    });
    await capture(p.creatorTracked, teId, order);
    const actual = [te[1], te[0], te[3], te[2], te[4], te[5], te[6], te[7]];
    for (const [index, rankableEntryId] of actual.entries()) {
      await prisma.contestEntry.updateMany({
        where: { contestId: teId, rankableEntryId },
        data: { actualRank: index + 1, fantasyPoints: 30 - index },
      });
    }

    const snapshot = async () =>
      (
        await prisma.rankingSubmission.findMany({
          where: { contestId: teId },
          include: { picks: { orderBy: { predictedRank: "asc" } } },
          orderBy: { universalProfileId: "asc" },
        })
      ).map((row) => ({
        normalizedScore: row.normalizedScore,
        rawScore: row.rawScore,
        picks: row.picks.map((pick) => [
          pick.predictedRank,
          pick.totalPoints,
          pick.slotLocked,
          pick.lockedRank,
          pick.wasUnavailableAtKickoff,
          JSON.stringify(pick.reserveEligiblePredecessorIds),
        ]),
      }));

    await gradeContest(teId);
    const graded = await snapshot();
    expect(graded).toHaveLength(3);
    for (const row of graded) {
      expect(row.normalizedScore).toBe(graded[0]!.normalizedScore);
      expect(row.picks).toEqual(graded[0]!.picks);
    }

    await prisma.rankingSubmission.updateMany({
      where: { contestId: teId },
      data: { authority: null },
    });
    await gradeContest(teId);
    expect(await snapshot()).toEqual(graded);
  });
});
