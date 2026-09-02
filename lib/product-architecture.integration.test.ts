import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { gradeContest } from "@/lib/grading";
import {
  getDefaultRankingScoringConfig,
  parseRankingScoringConfig,
} from "@/lib/ranking-scoring-version";
import { resolveScoringConfigForContest } from "@/lib/ranking-scoring-versions";
import { scoreContest } from "@/lib/scoring";
import {
  recordPolicyAcceptances,
  userHasAcceptedRequiredPolicies,
} from "@/lib/legal/policy-acceptance";

const suffix = `sv${Date.now()}`;

describe("scoring version historical integrity", () => {
  let seasonId = "";
  let weekId = "";
  let contestId = "";
  let frozenVersionId = "";
  let entryIds: string[] = [];

  beforeAll(async () => {
    const draftVersion = await prisma.rankingScoringVersion.create({
      data: {
        slug: `draft-${suffix}`,
        label: "Draft test version",
        status: "DRAFT",
        config: {
          ...getDefaultRankingScoringConfig(),
          baseHitPoints: 99,
        },
      },
    });
    frozenVersionId = draftVersion.id;

    const season = await prisma.season.create({
      data: {
        year: 2097,
        sport: `TEST-SV-${suffix}`,
        active: false,
        activeRankingScoringVersionId: draftVersion.id,
      },
    });
    seasonId = season.id;

    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: "Week 1",
        startsAt: new Date("2097-09-07T00:00:00Z"),
        endsAt: new Date("2097-09-14T00:00:00Z"),
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
        rankingScoringVersionId: draftVersion.id,
      },
    });
    contestId = contest.id;

    entryIds = [];
    for (let i = 1; i <= 12; i += 1) {
      const entry = await prisma.rankableEntry.create({
        data: {
          provider: "test",
          externalId: `sv-${suffix}-${i}`,
          type: "PLAYER",
          name: `Player ${i}`,
          shortName: `P${i}`,
          team: "TST",
          opponent: "@ OPP",
          position: "QB",
        },
      });
      await prisma.contestEntry.create({
        data: {
          contestId,
          rankableEntryId: entry.id,
          actualRank: i <= 10 ? i : null,
          fantasyPoints: 20 - i,
        },
      });
      entryIds.push(entry.id);
    }

    const human = await prisma.universalProfile.create({
      data: {
        username: `human-sv-${suffix}`,
        displayName: "SV Human",
        profileType: "HUMAN",
      },
    });

    const submission = await prisma.rankingSubmission.create({
      data: {
        contestId,
        universalProfileId: human.id,
        status: "SUBMITTED",
      },
    });

    for (let rank = 1; rank <= 10; rank += 1) {
      await prisma.rankingPick.create({
        data: {
          submissionId: submission.id,
          rankableEntryId: entryIds[rank - 1],
          predictedRank: rank,
        },
      });
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
      where: { externalId: { contains: suffix } },
    });
    await prisma.rankingScoringVersion.deleteMany({
      where: { slug: { contains: suffix } },
    });
    await prisma.universalProfile.deleteMany({
      where: { username: { contains: suffix } },
    });
  });

  it("freezes contest scoring version on grade", async () => {
    await gradeContest(contestId);
    const contest = await prisma.rankIQContest.findUniqueOrThrow({
      where: { id: contestId },
    });
    expect(contest.rankingScoringVersionId).toBe(frozenVersionId);

    const submission = await prisma.rankingSubmission.findFirstOrThrow({
      where: { contestId, status: "GRADED" },
    });
    const before = submission.rawScore;

    await prisma.rankingScoringVersion.update({
      where: { id: frozenVersionId },
      data: {
        config: {
          ...getDefaultRankingScoringConfig(),
          baseHitPoints: 1,
        },
      },
    });

    await gradeContest(contestId);

    const after = await prisma.rankingSubmission.findFirstOrThrow({
      where: { contestId, status: "GRADED" },
    });

    expect(after.rawScore).toBe(before);
  });

  it("resolveScoringConfigForContest uses frozen contest version", async () => {
    const resolved = await resolveScoringConfigForContest(contestId);
    expect(resolved.versionId).toBe(frozenVersionId);
    expect(resolved.config.baseHitPoints).toBe(99);
  });
});

describe("policy acceptance versioning", () => {
  const userId = `user-policy-${suffix}`;

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, email: `policy-${suffix}@example.com` },
    });
  });

  afterAll(async () => {
    await prisma.policyAcceptance.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("records versioned policy acceptance on signup policies", async () => {
    expect(await userHasAcceptedRequiredPolicies(userId)).toBe(false);
    await recordPolicyAcceptances(userId, ["terms", "privacy"]);
    expect(await userHasAcceptedRequiredPolicies(userId)).toBe(true);
  });
});

describe("parseRankingScoringConfig", () => {
  it("falls back safely for invalid config payloads", () => {
    const config = parseRankingScoringConfig(null);
    expect(config.baseHitPoints).toBe(getDefaultRankingScoringConfig().baseHitPoints);
  });
});

describe("alternate config scoring math", () => {
  it("changes scores when a draft version uses different weights", () => {
    const picks = [
      {
        playerId: "p1",
        playerName: "P1",
        predictedRank: 1,
        actualRank: 1,
      },
    ];
    const v1 = scoreContest(picks, 10, getDefaultRankingScoringConfig());
    const heavy = scoreContest(picks, 10, {
      ...getDefaultRankingScoringConfig(),
      baseHitPoints: 50,
    });
    expect(heavy.rawPoints).not.toBe(v1.rawPoints);
  });
});
