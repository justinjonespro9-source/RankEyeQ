import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { gradeContest } from "@/lib/grading";
import { getSeasonLeaderboard, getWeeklyLeaderboard } from "@/lib/leaderboards";
import { getRankIQProfileView } from "@/lib/profile-stats";
import {
  getOrCreateDraftSubmission,
  lockContestSubmissions,
  saveSubmissionPicks,
  submitRanking,
  SubmissionError,
} from "@/lib/submissions";

const suffix = `t${Date.now()}`;

describe("persistent contest lifecycle", () => {
  let seasonId = "";
  let weekId = "";
  let contestId = "";
  let humanId = "";
  let botId = "";
  let entryIds: string[] = [];

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2099,
        sport: `TEST-${suffix}`,
        active: false,
      },
    });
    seasonId = season.id;

    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: "Test Week 1",
        startsAt: new Date("2099-01-01T00:00:00Z"),
        endsAt: new Date("2099-01-07T00:00:00Z"),
        status: "OPEN",
      },
    });
    weekId = week.id;

    const contest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "QB",
        title: "Test QB",
        rankingDepth: 10,
        status: "OPEN",
      },
    });
    contestId = contest.id;

    const human = await prisma.universalProfile.create({
      data: {
        username: `human-${suffix}`,
        displayName: "Test Human",
        profileType: "HUMAN",
      },
    });
    humanId = human.id;

    const bot = await prisma.universalProfile.create({
      data: {
        username: `bot-${suffix}`,
        displayName: "Test Bot",
        profileType: "AI",
      },
    });
    botId = bot.id;

    entryIds = [];
    for (let i = 1; i <= 12; i += 1) {
      const entry = await prisma.rankableEntry.create({
        data: {
          provider: "test",
          externalId: `test-${suffix}-${i}`,
          type: "PLAYER",
          name: `Player ${i}`,
          shortName: `P${i}`,
          team: "TST",
          opponent: "@ OPP",
          position: "QB",
          gameStartsAt: new Date("2099-01-02T18:00:00Z"),
        },
      });
      await prisma.contestEntry.create({
        data: {
          contestId,
          rankableEntryId: entry.id,
        },
      });
      entryIds.push(entry.id);
    }
  });

  afterAll(async () => {
    await prisma.rankingPick.deleteMany({
      where: { submission: { contestId } },
    });
    await prisma.rankingSubmission.deleteMany({ where: { contestId } });
    await prisma.contestEntry.deleteMany({ where: { contestId } });
    await prisma.rankIQContest.deleteMany({ where: { id: contestId } });
    await prisma.week.deleteMany({ where: { id: weekId } });
    await prisma.season.deleteMany({ where: { id: seasonId } });
    await prisma.rankableEntry.deleteMany({
      where: { externalId: { startsWith: `test-${suffix}-` } },
    });
    await prisma.universalProfile.deleteMany({
      where: { id: { in: [humanId, botId] } },
    });
    await prisma.$disconnect();
  });

  it("creates and updates drafts", async () => {
    const draft = await getOrCreateDraftSubmission(contestId, humanId);
    expect(draft.status).toBe("DRAFT");

    const saved = await saveSubmissionPicks({
      contestId,
      universalProfileId: humanId,
      rankedEntryIds: entryIds.slice(0, 5),
    });
    expect(saved.picks).toHaveLength(5);
    expect(saved.status).toBe("DRAFT");
  });

  it("rejects incomplete submit", async () => {
    await expect(
      submitRanking({
        contestId,
        universalProfileId: humanId,
        rankedEntryIds: entryIds.slice(0, 5),
      }),
    ).rejects.toBeInstanceOf(SubmissionError);
  });

  it("requires explicit submit for eligibility", async () => {
    const completeDraftIds = entryIds.slice(0, 10);
    await saveSubmissionPicks({
      contestId,
      universalProfileId: humanId,
      rankedEntryIds: completeDraftIds,
      requireComplete: true,
    });

    const submitted = await submitRanking({
      contestId,
      universalProfileId: humanId,
      rankedEntryIds: completeDraftIds,
    });
    expect(submitted.status).toBe("SUBMITTED");

    // Bot uses identical path
    await submitRanking({
      contestId,
      universalProfileId: botId,
      rankedEntryIds: [...entryIds.slice(1, 11)],
    });
  });

  it("locks only submitted rankings and blocks edits", async () => {
    const { lockedCount } = await lockContestSubmissions(contestId);
    expect(lockedCount).toBe(2);

    const contest = await prisma.rankIQContest.findUniqueOrThrow({
      where: { id: contestId },
    });
    expect(contest.status).toBe("LOCKED");

    await expect(
      saveSubmissionPicks({
        contestId,
        universalProfileId: humanId,
        rankedEntryIds: entryIds.slice(0, 10),
      }),
    ).rejects.toBeInstanceOf(SubmissionError);
  });

  it("grades and regrades idempotently", async () => {
    // Set actual ranks for Top 10
    for (let i = 0; i < 10; i += 1) {
      await prisma.contestEntry.updateMany({
        where: { contestId, rankableEntryId: entryIds[i] },
        data: {
          actualRank: i + 1,
          fantasyPoints: 30 - i,
        },
      });
    }

    const first = await gradeContest(contestId);
    expect(first?.status).toBe("FINAL");

    const humanBefore = await prisma.rankingSubmission.findUniqueOrThrow({
      where: {
        contestId_universalProfileId: {
          contestId,
          universalProfileId: humanId,
        },
      },
      include: { picks: true },
    });
    expect(humanBefore.status).toBe("GRADED");
    expect(humanBefore.normalizedScore).toBe(100);
    expect(humanBefore.picks.every((pick) => pick.totalPoints != null)).toBe(
      true,
    );

    const pickCountBefore = await prisma.rankingPick.count({
      where: { submissionId: humanBefore.id },
    });

    const second = await gradeContest(contestId);
    expect(second?.status).toBe("FINAL");

    const humanAfter = await prisma.rankingSubmission.findUniqueOrThrow({
      where: {
        contestId_universalProfileId: {
          contestId,
          universalProfileId: humanId,
        },
      },
    });
    expect(humanAfter.normalizedScore).toBe(humanBefore.normalizedScore);
    expect(humanAfter.rawScore).toBe(humanBefore.rawScore);

    const pickCountAfter = await prisma.rankingPick.count({
      where: { submissionId: humanBefore.id },
    });
    expect(pickCountAfter).toBe(pickCountBefore);
  });

  it("builds weekly/season boards and filters AI/humans", async () => {
    const weeklyAll = await getWeeklyLeaderboard({
      weekId,
      filter: "ALL",
    });
    expect(weeklyAll.length).toBeGreaterThanOrEqual(2);
    expect(weeklyAll[0].averageScore).toBeGreaterThanOrEqual(
      weeklyAll[1]?.averageScore ?? 0,
    );

    const humans = await getWeeklyLeaderboard({ weekId, filter: "HUMAN" });
    expect(humans.every((row) => row.profileType === "HUMAN")).toBe(true);

    const ais = await getSeasonLeaderboard({
      seasonId,
      position: "QB",
      filter: "AI",
    });
    expect(ais.every((row) => row.profileType === "AI")).toBe(true);
    expect(ais.some((row) => row.universalProfileId === botId)).toBe(true);
  });

  it("computes profile aggregate stats", async () => {
    const view = await getRankIQProfileView(`human-${suffix}`);
    expect(view).not.toBeNull();
    expect(view!.contestsPlayed).toBeGreaterThanOrEqual(1);
    expect(view!.stats.averageRankingScore).toBe(100);
    expect(view!.history[0]?.numberOneHit).toBe(true);
  });
});
