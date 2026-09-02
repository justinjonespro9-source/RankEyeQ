import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ensureHistoricalTestWeek, TEST_SPORT } from "@/lib/admin/historical-test";
import { getFinalizeWeekReadiness } from "@/lib/nfl/finalize-week";
import { getSeasonLeaderboard, getWeeklyLeaderboard } from "@/lib/leaderboards";

const suffix = `hist${Date.now()}`;
const year = 3200 + (Date.now() % 700);

describe("historical test week isolation + finalize blockers", () => {
  let liveSeasonId = "";
  let liveWeekId = "";
  let sameSeasonTestWeekId = "";
  let histTestWeekId = "";
  let liveContestId = "";
  let testContestId = "";
  let profileId = "";

  beforeAll(async () => {
    const liveSeason = await prisma.season.create({
      data: {
        year,
        sport: `NFL-${suffix}`,
        active: false,
      },
    });
    liveSeasonId = liveSeason.id;
    const liveWeek = await prisma.week.create({
      data: {
        seasonId: liveSeasonId,
        weekNumber: 1,
        label: "Live Week 1",
        startsAt: new Date(`${year}-09-01T00:00:00Z`),
        endsAt: new Date(`${year}-09-08T00:00:00Z`),
        status: "COMPLETE",
        isTest: false,
      },
    });
    liveWeekId = liveWeek.id;
    const liveContest = await prisma.rankIQContest.create({
      data: {
        seasonId: liveSeasonId,
        weekId: liveWeekId,
        position: "QB",
        title: "Live QB",
        rankingDepth: 10,
        status: "FINAL",
      },
    });
    liveContestId = liveContest.id;

    const sameSeasonTestWeek = await prisma.week.create({
      data: {
        seasonId: liveSeasonId,
        weekNumber: 2,
        label: `[TEST] isolation ${suffix}`,
        startsAt: new Date(`${year}-09-08T00:00:00Z`),
        endsAt: new Date(`${year}-09-15T00:00:00Z`),
        status: "COMPLETE",
        isTest: true,
      },
    });
    sameSeasonTestWeekId = sameSeasonTestWeek.id;
    const testContest = await prisma.rankIQContest.create({
      data: {
        seasonId: liveSeasonId,
        weekId: sameSeasonTestWeekId,
        position: "QB",
        title: "[TEST] QB",
        rankingDepth: 10,
        status: "FINAL",
      },
    });
    testContestId = testContest.id;

    const histWeek = await ensureHistoricalTestWeek({
      year,
      weekNumber: 18,
    });
    histTestWeekId = histWeek.id;

    const profile = await prisma.universalProfile.create({
      data: {
        username: `hist_${suffix}`.slice(0, 24),
        displayName: "Hist Human",
        profileType: "HUMAN",
      },
    });
    profileId = profile.id;

    await prisma.rankingSubmission.createMany({
      data: [
        {
          contestId: liveContestId,
          universalProfileId: profileId,
          status: "GRADED",
          normalizedScore: 90,
        },
        {
          contestId: testContestId,
          universalProfileId: profileId,
          status: "GRADED",
          normalizedScore: 10,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.rankingSubmission.deleteMany({
      where: { universalProfileId: profileId },
    });
    await prisma.rankIQContest.deleteMany({
      where: { id: { in: [liveContestId, testContestId] } },
    });
    await prisma.week.deleteMany({
      where: { id: { in: [sameSeasonTestWeekId, liveWeekId, histTestWeekId] } },
    });
    await prisma.universalProfile.deleteMany({ where: { id: profileId } });
    await prisma.season.deleteMany({
      where: { OR: [{ id: liveSeasonId }, { year, sport: TEST_SPORT }] },
    });
  });

  it("excludes test weeks from public leaderboards unless explicitly requested", async () => {
    const publicWeekly = await getWeeklyLeaderboard({
      weekId: sameSeasonTestWeekId,
    });
    expect(publicWeekly).toHaveLength(0);
    const explicit = await getWeeklyLeaderboard({
      weekId: sameSeasonTestWeekId,
      includeTest: true,
    });
    expect(explicit.some((row) => row.universalProfileId === profileId)).toBe(true);

    const seasonPublic = await getSeasonLeaderboard({ seasonId: liveSeasonId });
    expect(seasonPublic.some((row) => row.averageScore === 10)).toBe(false);
    expect(seasonPublic.some((row) => row.averageScore === 90)).toBe(true);

    const seasonWithTest = await getSeasonLeaderboard({
      seasonId: liveSeasonId,
      includeTest: true,
    });
    expect(seasonWithTest.some((row) => row.averageScore === 50)).toBe(true);
  });

  it("marks historical test weeks as isTest on the NFL-TEST season", async () => {
    const week = await prisma.week.findUniqueOrThrow({
      where: { id: histTestWeekId },
      include: { season: true },
    });
    expect(week.isTest).toBe(true);
    expect(week.season.sport).toBe(TEST_SPORT);
    expect(week.season.active).toBe(false);
    expect(week.label.startsWith("[TEST]")).toBe(true);
  });

  it("blocks Finalize Week when provider data is incomplete", async () => {
    const readiness = await getFinalizeWeekReadiness(liveWeekId);
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons.length).toBeGreaterThan(0);
  });
});
