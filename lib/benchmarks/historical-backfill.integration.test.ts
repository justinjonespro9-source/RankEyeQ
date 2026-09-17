import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureBenchmarkSnapshot } from "@/lib/benchmarks/snapshots";
import { prisma } from "@/lib/db";
import { zonedLocalToUtc } from "@/lib/timing/chicago";

const suffix = `hbf${Date.now()}`;
const thursdayKickoff = zonedLocalToUtc(2026, 9, 10, 19, 20);
const sundayKickoff = zonedLocalToUtc(2026, 9, 13, 12, 0);
const sundayLock = zonedLocalToUtc(2026, 9, 13, 10, 0);
const thursdayPublish = zonedLocalToUtc(2026, 9, 10, 15, 0);
const fridayImport = zonedLocalToUtc(2026, 9, 11, 14, 0);
const afterLockImport = zonedLocalToUtc(2026, 9, 14, 12, 0);

describe("admin historical backfill capture (integration)", () => {
  let seasonId = "";
  let weekId = "";
  let contestId = "";
  let adminUserId = "";
  let creatorId = "";
  let expertId = "";
  let entryIds: string[] = [];
  let snapshotId = "";

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: { year: 2098, sport: `HBF-${suffix}`, active: false },
    });
    seasonId = season.id;

    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 2,
        label: "Backfill Test Week",
        startsAt: zonedLocalToUtc(2026, 9, 8, 0, 0),
        endsAt: zonedLocalToUtc(2026, 9, 15, 0, 0),
        status: "COMPLETE",
        fullLockAt: sundayLock,
        isTest: true,
      },
    });
    weekId = week.id;

    const contest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "RB",
        title: "Backfill RB",
        rankingDepth: 4,
        reserveCount: 0,
        status: "FINAL",
      },
    });
    contestId = contest.id;

    const admin = await prisma.user.create({
      data: {
        email: `admin-${suffix}@example.com`,
        name: "Backfill Admin",
        role: "ADMIN",
      },
    });
    adminUserId = admin.id;

    const creator = await prisma.universalProfile.create({
      data: {
        username: `creator-${suffix}`,
        displayName: "Backfill Creator",
        profileType: "CREATOR",
        universalUserId: `uu_creator_${suffix}`,
        competitorActive: true,
        publicVisible: true,
      },
    });
    creatorId = creator.id;

    const expert = await prisma.universalProfile.create({
      data: {
        username: `expert-${suffix}`,
        displayName: "Backfill Expert",
        profileType: "BENCHMARK",
        universalUserId: `uu_expert_${suffix}`,
        competitorActive: true,
        publicVisible: true,
      },
    });
    expertId = expert.id;

    const gameThu = await prisma.nflGame.create({
      data: {
        provider: "test",
        externalId: `thu-${suffix}`,
        seasonId,
        weekId,
        seasonYear: 2098,
        weekNumber: 2,
        homeTeam: "BUF",
        awayTeam: "DET",
        startsAt: thursdayKickoff,
        status: "FINAL",
      },
    });
    const gameSun = await prisma.nflGame.create({
      data: {
        provider: "test",
        externalId: `sun-${suffix}`,
        seasonId,
        weekId,
        seasonYear: 2098,
        weekNumber: 2,
        homeTeam: "KC",
        awayTeam: "PHI",
        startsAt: sundayKickoff,
        status: "FINAL",
      },
    });

    const players = [];
    for (let i = 0; i < 4; i += 1) {
      const kickoff = i < 2 ? thursdayKickoff : sundayKickoff;
      const gameId = i < 2 ? gameThu.id : gameSun.id;
      const entry = await prisma.rankableEntry.create({
        data: {
          provider: "test",
          externalId: `rb-${suffix}-${i}`,
          type: "PLAYER",
          name: `RB ${i + 1}`,
          shortName: `RB${i + 1}`,
          team: i < 2 ? "BUF" : "KC",
          opponent: i < 2 ? "DET" : "PHI",
          position: "RB",
          active: true,
          gameStartsAt: kickoff,
          gameId,
        },
      });
      players.push(entry);
      await prisma.contestEntry.create({
        data: {
          contestId,
          rankableEntryId: entry.id,
          gameId,
          actualRank: i + 1,
          fantasyPoints: 20 - i,
        },
      });
    }
    entryIds = players.map((p) => p.id);

    // Frozen pregame snapshot already exists — backfill must not rewrite it.
    snapshotId = (
      await prisma.contestPregameSnapshot.create({
        data: {
          contestId,
          lockedAt: sundayLock,
          sampleSizeAll: 1,
          sampleSizeHuman: 1,
          sampleSizeAi: 0,
          sampleSizeExpert: 0,
          sampleSizeCreator: 0,
          sampleSizePublisher: 0,
          allConsensusMode: "group_weighted",
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.contestPregameSnapshotEntry.deleteMany({
      where: { snapshotId },
    });
    await prisma.contestPregameSnapshot.deleteMany({
      where: { id: snapshotId },
    });
    await prisma.rankingPick.deleteMany({
      where: { submission: { contestId } },
    });
    await prisma.rankingSubmission.deleteMany({ where: { contestId } });
    await prisma.benchmarkSnapshotPick.deleteMany({
      where: { snapshot: { contestId } },
    });
    await prisma.benchmarkSnapshot.deleteMany({ where: { contestId } });
    await prisma.contestEntry.deleteMany({ where: { contestId } });
    await prisma.rankableEntry.deleteMany({
      where: { provider: "test", externalId: { startsWith: `rb-${suffix}` } },
    });
    await prisma.nflGame.deleteMany({
      where: { provider: "test", externalId: { startsWith: `thu-${suffix}` } },
    });
    await prisma.nflGame.deleteMany({
      where: { provider: "test", externalId: { startsWith: `sun-${suffix}` } },
    });
    await prisma.rankIQContest.deleteMany({ where: { id: contestId } });
    await prisma.week.deleteMany({ where: { id: weekId } });
    await prisma.season.deleteMany({ where: { id: seasonId } });
    await prisma.universalProfile.deleteMany({
      where: { id: { in: [creatorId, expertId] } },
    });
    await prisma.user.deleteMany({ where: { id: adminUserId } });
  });

  it("C/D/F. historically valid Creator board after Week COMPLETE grades without rewriting consensus", async () => {
    const beforeSnap = await prisma.contestPregameSnapshot.findUniqueOrThrow({
      where: { id: snapshotId },
    });

    const picks = entryIds.map((id, index) => ({
      sourceRank: index + 1,
      rawName: `RB ${index + 1}`,
      rankableEntryId: id,
      rankIqRank: index + 1,
      excluded: false,
      exclusionReason: null,
      issue: null,
      selected: true,
    }));

    const result = await captureBenchmarkSnapshot({
      contestId,
      universalProfileId: creatorId,
      adminUserId: adminUserId,
      captureType: "MANUAL_FINAL",
      capturedAt: fridayImport,
      sourcePublishedAt: thursdayPublish,
      sourceUrl: "https://example.com/creator-rankings",
      historicalBackfill: true,
      commitOfficial: true,
      picks,
    });

    expect(result.late).toBe(false);
    expect(result.official).toBe(true);
    expect(result.snapshot.historicalBackfill).toBe(true);
    expect(result.snapshot.enteredAfterWeekComplete).toBe(true);
    expect(result.snapshot.sourcePublishedAt?.toISOString()).toBe(
      thursdayPublish.toISOString(),
    );

    const submission = await prisma.rankingSubmission.findUniqueOrThrow({
      where: {
        contestId_universalProfileId: {
          contestId,
          universalProfileId: creatorId,
        },
      },
      include: { picks: true },
    });
    expect(submission.historicalBackfill).toBe(true);
    expect(submission.submittedAt?.toISOString()).toBe(
      thursdayPublish.toISOString(),
    );
    expect(submission.status).toBe("GRADED");
    expect(submission.normalizedScore).not.toBeNull();
    expect(submission.picks).toHaveLength(4);

    const afterSnap = await prisma.contestPregameSnapshot.findUniqueOrThrow({
      where: { id: snapshotId },
    });
    expect(afterSnap.sampleSizeAll).toBe(beforeSnap.sampleSizeAll);
    expect(afterSnap.sampleSizeCreator).toBe(beforeSnap.sampleSizeCreator);
    expect(afterSnap.lockedAt.toISOString()).toBe(sundayLock.toISOString());
    expect(afterSnap.id).toBe(beforeSnap.id);
  });

  it("E. source after lock stays tracking-only (no official submission)", async () => {
    const result = await captureBenchmarkSnapshot({
      contestId,
      universalProfileId: expertId,
      adminUserId: adminUserId,
      captureType: "SUNDAY",
      capturedAt: afterLockImport,
      sourcePublishedAt: afterLockImport,
      historicalBackfill: true,
      commitOfficial: true,
      picks: entryIds.map((id, index) => ({
        sourceRank: index + 1,
        rawName: `RB ${index + 1}`,
        rankableEntryId: id,
        rankIqRank: index + 1,
        excluded: false,
        exclusionReason: null,
        issue: null,
        selected: true,
      })),
    });

    expect(result.late).toBe(true);
    expect(result.official).toBe(false);
    expect(result.snapshot.status).toBe("LATE");

    const submission = await prisma.rankingSubmission.findUnique({
      where: {
        contestId_universalProfileId: {
          contestId,
          universalProfileId: expertId,
        },
      },
    });
    expect(submission).toBeNull();
  });

  it("B. ordinary late capture without backfill remains non-official", async () => {
    const profile = await prisma.universalProfile.create({
      data: {
        username: `expert2-${suffix}`,
        displayName: "Late Expert",
        profileType: "BENCHMARK",
        universalUserId: `uu_expert2_${suffix}`,
        competitorActive: true,
        publicVisible: true,
      },
    });

    const result = await captureBenchmarkSnapshot({
      contestId,
      universalProfileId: profile.id,
      adminUserId: adminUserId,
      captureType: "SUNDAY",
      capturedAt: afterLockImport,
      sourcePublishedAt: thursdayPublish,
      historicalBackfill: false,
      commitOfficial: true,
      picks: entryIds.map((id, index) => ({
        sourceRank: index + 1,
        rawName: `RB ${index + 1}`,
        rankableEntryId: id,
        rankIqRank: index + 1,
        excluded: false,
        exclusionReason: null,
        issue: null,
        selected: true,
      })),
    });

    expect(result.late).toBe(true);
    expect(result.official).toBe(false);

    await prisma.benchmarkSnapshotPick.deleteMany({
      where: { snapshot: { universalProfileId: profile.id } },
    });
    await prisma.benchmarkSnapshot.deleteMany({
      where: { universalProfileId: profile.id },
    });
    await prisma.universalProfile.delete({ where: { id: profile.id } });
  });
});
