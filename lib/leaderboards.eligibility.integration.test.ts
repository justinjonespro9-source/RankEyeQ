import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { filterEligibleConsensusSubmissions } from "@/lib/consensus-filters";
import { prisma } from "@/lib/db";
import {
  getSeasonLeaderboard,
  getWeeklyLeaderboard,
} from "@/lib/leaderboards";
import { getLiveContestRankerBoard } from "@/lib/live-rankiq";

const suffix = `lbelig${Date.now()}`;

describe("leaderboard empty-competitor eligibility", () => {
  let seasonId = "";
  let weekId = "";
  let contestId = "";
  let expertNoSubId = "";
  let creatorNoSubId = "";
  let aiNoSubId = "";
  let expertDraftId = "";
  let expertGradedId = "";
  let creatorGradedId = "";
  let aiGradedId = "";
  let humanGradedId = "";
  const playerIds: string[] = [];

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2099,
        sport: `TEST-LBELIG-${suffix}`,
        active: false,
      },
    });
    seasonId = season.id;

    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 2,
        label: "Week 2",
        startsAt: new Date("2099-09-10T00:00:00Z"),
        endsAt: new Date("2099-09-17T00:00:00Z"),
        status: "COMPLETE",
        isTest: true,
        fullLockAt: new Date("2099-09-14T15:00:00Z"),
        rankingsOpenAt: new Date("2099-09-10T12:00:00Z"),
        revealStartsAt: new Date("2099-09-14T15:00:00Z"),
        publicReleaseAt: new Date("2099-09-14T15:00:00Z"),
      },
    });
    weekId = week.id;

    const contest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "RB",
        title: "Week 2 RB",
        rankingDepth: 4,
        status: "FINAL",
      },
    });
    contestId = contest.id;

    for (const name of ["Alpha", "Beta", "Gamma", "Delta"]) {
      const player = await prisma.rankableEntry.create({
        data: {
          provider: "test",
          externalId: `lbelig-${name.toLowerCase()}-${suffix}`,
          type: "PLAYER",
          name,
          shortName: name,
          team: "MIN",
          opponent: "vs GB",
          position: "RB",
          active: true,
        },
      });
      playerIds.push(player.id);
      await prisma.contestEntry.create({
        data: {
          contestId,
          rankableEntryId: player.id,
          excluded: false,
          actualRank: playerIds.length,
          fantasyPoints: 20 - playerIds.length,
        },
      });
    }

    async function profile(
      username: string,
      profileType: "HUMAN" | "AI" | "BENCHMARK" | "CREATOR",
    ) {
      const row = await prisma.universalProfile.create({
        data: {
          username: `${username}-${suffix}`,
          displayName: username,
          profileType,
          competitorActive: true,
        },
      });
      return row.id;
    }

    expertNoSubId = await profile("expert-empty", "BENCHMARK");
    creatorNoSubId = await profile("creator-empty", "CREATOR");
    aiNoSubId = await profile("ai-empty", "AI");
    expertDraftId = await profile("expert-draft", "BENCHMARK");
    expertGradedId = await profile("expert-graded", "BENCHMARK");
    creatorGradedId = await profile("creator-graded", "CREATOR");
    aiGradedId = await profile("ai-graded", "AI");
    humanGradedId = await profile("human-graded", "HUMAN");

    await prisma.rankingSubmission.create({
      data: {
        contestId,
        universalProfileId: expertDraftId,
        status: "DRAFT",
      },
    });

    async function gradedBoard(profileId: string, order: string[]) {
      const submission = await prisma.rankingSubmission.create({
        data: {
          contestId,
          universalProfileId: profileId,
          status: "GRADED",
          submittedAt: new Date("2099-09-13T12:00:00Z"),
          lockedAt: new Date("2099-09-14T15:00:00Z"),
          normalizedScore: 90,
          rawScore: 90,
        },
      });
      for (const [index, playerId] of order.entries()) {
        await prisma.rankingPick.create({
          data: {
            submissionId: submission.id,
            rankableEntryId: playerId,
            predictedRank: index + 1,
            actualRank: index + 1,
          },
        });
      }
    }

    await gradedBoard(expertGradedId, playerIds);
    await gradedBoard(creatorGradedId, playerIds);
    await gradedBoard(aiGradedId, playerIds);
    await gradedBoard(humanGradedId, playerIds);

    // Corrupt empty GRADED shell — must still be excluded by picks: { some: {} }.
    await prisma.rankingSubmission.create({
      data: {
        contestId,
        universalProfileId: await profile("expert-empty-graded", "BENCHMARK"),
        status: "GRADED",
        normalizedScore: 50,
        rawScore: 50,
      },
    });
  });

  afterAll(async () => {
    await prisma.season.delete({ where: { id: seasonId } });
  });

  it("hides Experts/Creators/AI with no submissions or draft-only boards", async () => {
    const weeklyExperts = await getWeeklyLeaderboard({
      weekId,
      filter: "EXPERT",
      includeTest: true,
    });
    const weeklyCreators = await getWeeklyLeaderboard({
      weekId,
      filter: "CREATOR",
      includeTest: true,
    });
    const weeklyAi = await getWeeklyLeaderboard({
      weekId,
      filter: "AI",
      includeTest: true,
    });
    const weeklyAll = await getWeeklyLeaderboard({
      weekId,
      filter: "ALL",
      includeTest: true,
    });
    const seasonExperts = await getSeasonLeaderboard({
      seasonId,
      filter: "EXPERT",
      includeTest: true,
    });

    expect(
      weeklyExperts.some((row) => row.universalProfileId === expertNoSubId),
    ).toBe(false);
    expect(
      weeklyExperts.some((row) => row.universalProfileId === expertDraftId),
    ).toBe(false);
    expect(
      weeklyCreators.some((row) => row.universalProfileId === creatorNoSubId),
    ).toBe(false);
    expect(weeklyAi.some((row) => row.universalProfileId === aiNoSubId)).toBe(
      false,
    );
    expect(
      seasonExperts.some((row) => row.universalProfileId === expertNoSubId),
    ).toBe(false);

    expect(
      weeklyExperts.some((row) => row.universalProfileId === expertGradedId),
    ).toBe(true);
    expect(
      weeklyCreators.some((row) => row.universalProfileId === creatorGradedId),
    ).toBe(true);
    expect(weeklyAi.some((row) => row.universalProfileId === aiGradedId)).toBe(
      true,
    );
    expect(
      weeklyAll.some((row) => row.universalProfileId === humanGradedId),
    ).toBe(true);

    expect(weeklyExperts.every((row) => row.profileType === "BENCHMARK")).toBe(
      true,
    );
    expect(weeklyCreators.every((row) => row.profileType === "CREATOR")).toBe(
      true,
    );
    expect(weeklyAi.every((row) => row.profileType === "AI")).toBe(true);
    expect(weeklyExperts.every((row) => row.contestsPlayed >= 1)).toBe(true);
  });

  it("keeps class filters unchanged after one valid submission", async () => {
    const humans = await getWeeklyLeaderboard({
      weekId,
      filter: "HUMAN",
      includeTest: true,
    });
    const experts = await getWeeklyLeaderboard({
      weekId,
      filter: "EXPERT",
      includeTest: true,
    });
    expect(humans.every((row) => row.profileType === "HUMAN")).toBe(true);
    expect(experts.every((row) => row.profileType === "BENCHMARK")).toBe(true);
    expect(humans.some((row) => row.universalProfileId === expertGradedId)).toBe(
      false,
    );
  });

  it("excludes empty shells from live boards and consensus", async () => {
    // Live board needs provisional fantasy points; entries already have points.
    const live = await getLiveContestRankerBoard(contestId);
    expect(live.some((row) => row.universalProfileId === expertNoSubId)).toBe(
      false,
    );
    expect(live.some((row) => row.universalProfileId === expertDraftId)).toBe(
      false,
    );
    expect(live.some((row) => row.universalProfileId === expertGradedId)).toBe(
      true,
    );

    const consensus = filterEligibleConsensusSubmissions(
      [
        {
          id: expertNoSubId,
          status: "LOCKED" as const,
          profileType: "BENCHMARK" as const,
          picks: [],
        },
        {
          id: expertGradedId,
          status: "GRADED" as const,
          profileType: "BENCHMARK" as const,
          picks: playerIds.map((id) => ({ id })),
        },
      ],
      "EXPERT",
    );
    expect(consensus.map((row) => row.id)).toEqual([expertGradedId]);
  });
});
