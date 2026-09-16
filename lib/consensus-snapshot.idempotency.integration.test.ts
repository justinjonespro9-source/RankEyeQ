import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { captureContestPregameSnapshotsForWeek } from "@/lib/consensus-snapshot";
import { rankingDepthForPosition } from "@/lib/contest-defaults";
import { FANTASYTRACK_NFL_HALF_PPR_V2 } from "@/lib/fantasy/scoring-config";
import { computeNflTimingWindows } from "@/lib/timing/week-windows";

const suffix = `snapidem${Date.now()}`;

/**
 * Documents the Week 1 production failure mode:
 * early wrong fullLockAt → snapshot frozen → later real lock skips overwrite.
 */
describe("pregame snapshot capture is idempotent (Week 1 Sept 6 bug)", () => {
  let seasonId = "";
  let weekId = "";
  let contestId = "";
  let profileId = "";

  const earlyLock = computeNflTimingWindows(
    new Date("2026-09-03T00:20:00.000Z"),
  ).fullLockAt;
  const canonicalLock = computeNflTimingWindows(
    new Date("2026-09-10T00:20:00.000Z"),
  ).fullLockAt;

  beforeAll(async () => {
    expect(earlyLock.toISOString()).toBe("2026-09-06T15:00:00.000Z");
    expect(canonicalLock.toISOString()).toBe("2026-09-13T15:00:00.000Z");

    const season = await prisma.season.create({
      data: {
        year: 2094,
        sport: `NFL-SNAP-${suffix}`,
        active: false,
        fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
      },
    });
    seasonId = season.id;

    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: `[TEST] Snapshot idempotency ${suffix}`,
        startsAt: new Date("2026-09-01T00:00:00Z"),
        endsAt: new Date("2026-09-08T00:00:00Z"),
        status: "LOCKED",
        isTest: true,
        fullLockAt: earlyLock,
        fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
      },
    });
    weekId = week.id;

    const contest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "QB",
        title: "QB Top 10",
        rankingDepth: rankingDepthForPosition("QB"),
        reserveCount: 0,
        status: "LOCKED",
      },
    });
    contestId = contest.id;

    const profile = await prisma.universalProfile.create({
      data: {
        username: `snap-${suffix}`,
        displayName: "Early Human",
        profileType: "HUMAN",
        publicVisible: true,
        competitorActive: true,
      },
    });
    profileId = profile.id;

    const entries = [];
    for (let i = 0; i < 10; i += 1) {
      const entry = await prisma.rankableEntry.create({
        data: {
          provider: "manual",
          externalId: `snap-qb-${i}-${suffix}`,
          type: "PLAYER",
          name: `QB ${i}`,
          shortName: `Q${i}`,
          team: "AAA",
          opponent: "vs BBB",
          position: "QB",
          active: true,
        },
      });
      entries.push(entry);
      await prisma.contestEntry.create({
        data: {
          contestId,
          rankableEntryId: entry.id,
          excluded: false,
        },
      });
    }

    const submission = await prisma.rankingSubmission.create({
      data: {
        contestId,
        universalProfileId: profileId,
        status: "LOCKED",
        submittedAt: new Date("2026-09-05T12:00:00Z"),
        lockedAt: earlyLock,
      },
    });
    for (let i = 0; i < 10; i += 1) {
      await prisma.rankingPick.create({
        data: {
          submissionId: submission.id,
          rankableEntryId: entries[i]!.id,
          predictedRank: i + 1,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.contestPregameSnapshotEntry.deleteMany({
      where: { snapshot: { contestId } },
    });
    await prisma.contestPregameSnapshot.deleteMany({ where: { contestId } });
    await prisma.rankingPick.deleteMany({
      where: { submission: { contestId } },
    });
    await prisma.rankingSubmission.deleteMany({ where: { contestId } });
    await prisma.contestEntry.deleteMany({ where: { contestId } });
    await prisma.rankIQContest.deleteMany({ where: { id: contestId } });
    await prisma.rankableEntry.deleteMany({
      where: { externalId: { startsWith: "snap-qb-" } },
    });
    await prisma.week.deleteMany({ where: { id: weekId } });
    await prisma.season.deleteMany({ where: { id: seasonId } });
    await prisma.universalProfile.deleteMany({ where: { id: profileId } });
    await prisma.$disconnect();
  });

  it("first capture freezes early lock + sampleSize 1; second canonical capture detects stale and skips without replaceStale", async () => {
    const first = await captureContestPregameSnapshotsForWeek(weekId, earlyLock);
    expect(first.captured).toBe(1);
    expect(first.skipped).toBe(0);

    const snap = await prisma.contestPregameSnapshot.findUniqueOrThrow({
      where: { contestId },
    });
    expect(snap.lockedAt.toISOString()).toBe(earlyLock.toISOString());
    expect(snap.sampleSizeHuman).toBe(1);
    expect(snap.sampleSizeAll).toBe(1);

    await prisma.week.update({
      where: { id: weekId },
      data: { fullLockAt: canonicalLock },
    });

    const second = await captureContestPregameSnapshotsForWeek(
      weekId,
      canonicalLock,
    );
    expect(second.captured).toBe(0);
    expect(second.staleDetected).toBe(1);
    expect(second.staleReplaced).toBe(0);
    expect(second.skipped).toBe(1);

    const still = await prisma.contestPregameSnapshot.findUniqueOrThrow({
      where: { contestId },
    });
    expect(still.lockedAt.toISOString()).toBe(earlyLock.toISOString());
    expect(still.sampleSizeAll).toBe(1);
  });

  it("replaceStale:true rebuilds snapshot at canonical lock", async () => {
    const replaced = await captureContestPregameSnapshotsForWeek(
      weekId,
      canonicalLock,
      { replaceStale: true },
    );
    expect(replaced.staleDetected).toBe(1);
    expect(replaced.staleReplaced).toBe(1);
    expect(replaced.captured).toBe(1);

    const snap = await prisma.contestPregameSnapshot.findUniqueOrThrow({
      where: { contestId },
    });
    expect(snap.lockedAt.toISOString()).toBe(canonicalLock.toISOString());
  });
});
