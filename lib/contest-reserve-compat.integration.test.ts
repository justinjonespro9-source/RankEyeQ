import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  CONTEST_POSITIONS,
  isScorablePickCount,
  RESERVE_COUNT,
  rankingDepthForPosition,
  submissionDepthFromScoring,
} from "@/lib/contest-defaults";
import { gradeContest } from "@/lib/grading";
import { getWeeklyLeaderboard } from "@/lib/leaderboards";
import { getContestConsensus } from "@/lib/consensus";
import { FANTASYTRACK_NFL_HALF_PPR_V2 } from "@/lib/fantasy/scoring-config";
import type { ContestPosition } from "@/lib/generated/prisma/client";

const suffix = `rescompat${Date.now()}`;

describe("contest reserveCount compatibility", () => {
  it("legacy reserveCount=0 treats Top10/Top15 as complete", () => {
    expect(isScorablePickCount(10, 10, 0)).toBe(true);
    expect(isScorablePickCount(12, 10, 0)).toBe(false);
    expect(isScorablePickCount(15, 15, 0)).toBe(true);
    expect(isScorablePickCount(17, 15, 0)).toBe(false);
    expect(submissionDepthFromScoring(10, 0)).toBe(10);
    expect(submissionDepthFromScoring(15, 0)).toBe(15);
  });

  it("reserve-enabled contests accept scoring-only through +2", () => {
    expect(isScorablePickCount(10, 10, 2)).toBe(true);
    expect(isScorablePickCount(12, 10, 2)).toBe(true);
    expect(isScorablePickCount(13, 10, 2)).toBe(false);
    expect(isScorablePickCount(15, 15, 2)).toBe(true);
    expect(isScorablePickCount(17, 15, 2)).toBe(true);
    expect(submissionDepthFromScoring(10, RESERVE_COUNT)).toBe(12);
    expect(submissionDepthFromScoring(15, RESERVE_COUNT)).toBe(17);
  });
});

describe("legacy no-reserve week grades + public surfaces", () => {
  let seasonId = "";
  let weekId = "";
  let humanId = "";
  let aiId = "";
  let privateExpertId = "";
  const contestIds = new Map<ContestPosition, string>();

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2095,
        sport: `NFL-RES-${suffix}`,
        active: false,
        fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
      },
    });
    seasonId = season.id;

    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: `[TEST] Legacy reserves ${suffix}`,
        startsAt: new Date("2095-09-07T00:00:00Z"),
        endsAt: new Date("2095-09-15T00:00:00Z"),
        status: "LOCKED",
        isTest: true,
        fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
        fullLockAt: new Date("2095-09-14T15:00:00Z"),
      },
    });
    weekId = week.id;

    const human = await prisma.universalProfile.create({
      data: {
        username: `h-${suffix}`,
        displayName: "Legacy Human",
        profileType: "HUMAN",
        publicVisible: true,
        competitorActive: true,
      },
    });
    humanId = human.id;

    const ai = await prisma.universalProfile.create({
      data: {
        username: `ai-${suffix}`,
        displayName: "Legacy AI",
        profileType: "AI",
        publicVisible: true,
        competitorActive: true,
      },
    });
    aiId = ai.id;

    const privateExpert = await prisma.universalProfile.create({
      data: {
        username: `ex-${suffix}`,
        displayName: "Private Expert",
        profileType: "BENCHMARK",
        publicVisible: false,
        competitorActive: true,
      },
    });
    privateExpertId = privateExpert.id;

    for (const position of CONTEST_POSITIONS) {
      const depth = rankingDepthForPosition(position);
      const contest = await prisma.rankIQContest.create({
        data: {
          seasonId,
          weekId,
          position,
          title: `${position} Top ${depth}`,
          rankingDepth: depth,
          reserveCount: 0,
          status: "LOCKED",
        },
      });
      contestIds.set(position, contest.id);

      const entryIds: string[] = [];
      for (let i = 0; i < depth + 5; i += 1) {
        const entry = await prisma.rankableEntry.create({
          data: {
            provider: "manual",
            externalId: `res-${position}-${i}-${suffix}`,
            type: position === "DEF" ? "DEFENSE" : "PLAYER",
            name: `${position} ${i}`,
            shortName: `${position}${i}`,
            team: position === "DEF" ? `T${i}` : "AAA",
            opponent: "vs OPP",
            position,
            active: true,
          },
        });
        entryIds.push(entry.id);
        await prisma.contestEntry.create({
          data: {
            contestId: contest.id,
            rankableEntryId: entry.id,
            fantasyPoints: Math.max(0.5, (depth + 5 - i) * 2),
            actualRank: i + 1,
            excluded: false,
          },
        });
      }

      for (const profileId of [humanId, aiId, privateExpertId]) {
        const submission = await prisma.rankingSubmission.create({
          data: {
            contestId: contest.id,
            universalProfileId: profileId,
            status: "LOCKED",
            lockedAt: new Date("2095-09-14T14:00:00Z"),
          },
        });
        for (let rank = 1; rank <= depth; rank += 1) {
          await prisma.rankingPick.create({
            data: {
              submissionId: submission.id,
              rankableEntryId: entryIds[rank - 1]!,
              predictedRank: rank,
            },
          });
        }
      }

      // Frozen pregame snapshot — must survive grading.
      await prisma.contestPregameSnapshot.create({
        data: {
          contestId: contest.id,
          lockedAt: new Date("2095-09-14T15:00:00Z"),
          sampleSizeAll: 2,
          sampleSizeHuman: 1,
          sampleSizeAi: 1,
          sampleSizeExpert: 0,
          sampleSizeCreator: 0,
          sampleSizePublisher: 0,
          allConsensusMode: "group_weighted",
          entries: {
            create: entryIds.slice(0, depth).map((rankableEntryId, index) => ({
              rankableEntryId,
              selectionRateAll: 1,
              averageSelectedRankAll: index + 1,
              consensusRankAll: index + 1,
              selectionRateHuman: 1,
              averageSelectedRankHuman: index + 1,
              consensusRankHuman: index + 1,
              selectionRateAi: 1,
              averageSelectedRankAi: index + 1,
              consensusRankAi: index + 1,
              selectionRateExpert: 0,
              averageSelectedRankExpert: null,
              consensusRankExpert: null,
              selectionRateCreator: 0,
              averageSelectedRankCreator: null,
              consensusRankCreator: null,
              selectionRatePublisher: 0,
              averageSelectedRankPublisher: null,
              consensusRankPublisher: null,
              selectedCountAll: 2,
              selectedCountHuman: 1,
              selectedCountAi: 1,
              selectedCountExpert: 0,
              selectedCountCreator: 0,
              selectedCountPublisher: 0,
            })),
          },
        },
      });
    }
  }, 120_000);

  afterAll(async () => {
    await prisma.contestPregameSnapshotEntry.deleteMany({
      where: { snapshot: { contest: { weekId } } },
    });
    await prisma.contestPregameSnapshot.deleteMany({
      where: { contest: { weekId } },
    });
    await prisma.rankingPick.deleteMany({
      where: { submission: { contest: { weekId } } },
    });
    await prisma.rankingSubmission.deleteMany({
      where: { contest: { weekId } },
    });
    await prisma.contestEntry.deleteMany({ where: { contest: { weekId } } });
    await prisma.rankIQContest.deleteMany({ where: { weekId } });
    await prisma.rankableEntry.deleteMany({
      where: { externalId: { startsWith: "res-" }, provider: "manual" },
    });
    await prisma.week.deleteMany({ where: { id: weekId } });
    await prisma.season.deleteMany({ where: { id: seasonId } });
    await prisma.universalProfile.deleteMany({
      where: { id: { in: [humanId, aiId, privateExpertId] } },
    });
    await prisma.$disconnect();
  });

  it("grades all five legacy positions without requiring reserves", async () => {
    for (const position of CONTEST_POSITIONS) {
      const result = await gradeContest(contestIds.get(position)!);
      expect(result.status).toBe("FINAL");
      expect(result.graded).toBe(3);
      expect(result.skipped).toBe(0);
    }

    const contests = await prisma.rankIQContest.findMany({ where: { weekId } });
    expect(contests.every((c) => c.status === "FINAL")).toBe(true);

    const graded = await prisma.rankingSubmission.count({
      where: {
        contest: { weekId },
        status: "GRADED",
        normalizedScore: { not: null },
      },
    });
    expect(graded).toBe(CONTEST_POSITIONS.length * 3);
  }, 120_000);

  it("populates leaderboard for public graded boards only", async () => {
    const rows = await getWeeklyLeaderboard({
      weekId,
      filter: "ALL",
      includeTest: true,
    });
    const ids = rows.map((row) => row.universalProfileId);
    expect(ids).toContain(humanId);
    expect(ids).toContain(aiId);
    expect(ids).not.toContain(privateExpertId);
  });

  it("serves frozen pregame snapshot after grading (not live 1-ballot)", async () => {
    const consensus = await getContestConsensus(contestIds.get("QB")!, "ALL");
    expect(consensus.fromSnapshot).toBe(true);
    expect(consensus.totalEntryCount ?? consensus.sampleSize).toBe(2);
    expect(consensus.contributingGroupCount).toBe(2);

    const snapshot = await prisma.contestPregameSnapshot.findUniqueOrThrow({
      where: { contestId: contestIds.get("QB")! },
    });
    expect(snapshot.sampleSizeAll).toBe(2);
  });

  it("exposes all five FINAL contests for Results tabs", async () => {
    const contests = await prisma.rankIQContest.findMany({
      where: {
        weekId,
        status: { in: ["FINAL", "ARCHIVED"] },
      },
      orderBy: { position: "asc" },
    });
    expect(contests.map((c) => c.position)).toEqual([
      "QB",
      "RB",
      "WR",
      "TE",
      "DEF",
    ]);
  });
});

describe("reserve-enabled week still uses +2 submission depth", () => {
  it("Human/AI boards require 12/17 when reserveCount=2", async () => {
    expect(submissionDepthFromScoring(10, 2)).toBe(12);
    expect(submissionDepthFromScoring(15, 2)).toBe(17);
    expect(isScorablePickCount(10, 10, 2)).toBe(true); // experts still ok
    expect(isScorablePickCount(12, 10, 2)).toBe(true);
    expect(isScorablePickCount(9, 10, 2)).toBe(false);
  });
});
