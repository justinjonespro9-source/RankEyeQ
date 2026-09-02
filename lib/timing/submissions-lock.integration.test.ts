import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { submissionIsEligible } from "@/lib/contest-lifecycle";
import { getLiveContestRankerBoard } from "@/lib/live-rankiq";
import {
  saveSubmissionPicks,
  submitRanking,
  SubmissionError,
} from "@/lib/submissions";
import { zonedLocalToUtc } from "@/lib/timing/chicago";
import { computeNflTimingWindows } from "@/lib/timing/week-windows";

const suffix = `lock${Date.now()}`;
const thursdayKickoff = zonedLocalToUtc(2026, 9, 10, 19, 15);
const sundayNoonKickoff = zonedLocalToUtc(2026, 9, 13, 12, 0);
const timing = computeNflTimingWindows(thursdayKickoff, sundayNoonKickoff);

describe("submission partial lock + Sunday lock", () => {
  let seasonId = "";
  let weekId = "";
  let contestId = "";
  let humanId = "";
  let gibbsId = "";
  let bijanId = "";
  let taylorId = "";
  let achaneId = "";
  const extraIds: string[] = [];

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2098,
        sport: `LOCK-${suffix}`,
        active: false,
      },
    });
    seasonId = season.id;

    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: "Lock Week",
        startsAt: thursdayKickoff,
        endsAt: sundayNoonKickoff,
        status: "OPEN",
        rankingsOpenAt: timing.rankingsOpenAt,
        fullLockAt: timing.fullLockAt,
        revealStartsAt: timing.revealStartsAt,
        publicReleaseAt: timing.publicReleaseAt,
      },
    });
    weekId = week.id;

    const contest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "RB",
        title: "Lock RB",
        rankingDepth: 4,
        status: "OPEN",
      },
    });
    contestId = contest.id;

    const human = await prisma.universalProfile.create({
      data: {
        username: `lock-human-${suffix}`,
        displayName: "Lock Human",
        profileType: "HUMAN",
      },
    });
    humanId = human.id;

    const names = [
      ["Gibbs", thursdayKickoff],
      ["Bijan", sundayNoonKickoff],
      ["Taylor", sundayNoonKickoff],
      ["Achane", sundayNoonKickoff],
      ["Henry", sundayNoonKickoff],
    ] as const;

    for (const [name, kickoff] of names) {
      const entry = await prisma.rankableEntry.create({
        data: {
          provider: "test",
          externalId: `lock-${suffix}-${name}`,
          type: "PLAYER",
          name,
          shortName: name,
          team: "TST",
          opponent: "@ OPP",
          position: "RB",
          gameStartsAt: kickoff,
        },
      });
      await prisma.contestEntry.create({
        data: {
          contestId,
          rankableEntryId: entry.id,
        },
      });
      if (name === "Gibbs") gibbsId = entry.id;
      else if (name === "Bijan") bijanId = entry.id;
      else if (name === "Taylor") taylorId = entry.id;
      else if (name === "Achane") achaneId = entry.id;
      else extraIds.push(entry.id);
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
      where: { externalId: { startsWith: `lock-${suffix}-` } },
    });
    await prisma.universalProfile.deleteMany({ where: { id: humanId } });
    await prisma.$disconnect();
  });

  it("allows Tuesday/open editing and keeps complete unsubmitted drafts non-competing", async () => {
    const beforeKickoff = zonedLocalToUtc(2026, 9, 10, 18, 0);
    await saveSubmissionPicks({
      contestId,
      universalProfileId: humanId,
      rankedEntryIds: [gibbsId, bijanId, taylorId, achaneId],
      now: beforeKickoff,
    });
    const draft = await prisma.rankingSubmission.findUniqueOrThrow({
      where: {
        contestId_universalProfileId: {
          contestId,
          universalProfileId: humanId,
        },
      },
    });
    expect(draft.status).toBe("DRAFT");
    expect(submissionIsEligible(draft.status)).toBe(false);
  });

  it("cannot add/remove/move a Thursday player after kickoff, but can reorder around them", async () => {
    const afterKickoff = zonedLocalToUtc(2026, 9, 10, 19, 20);

    await expect(
      saveSubmissionPicks({
        contestId,
        universalProfileId: humanId,
        rankedEntryIds: [extraIds[0], bijanId, taylorId, achaneId],
        now: afterKickoff,
      }),
    ).rejects.toBeInstanceOf(SubmissionError);

    await expect(
      saveSubmissionPicks({
        contestId,
        universalProfileId: humanId,
        rankedEntryIds: [bijanId, taylorId, achaneId, extraIds[0]],
        now: afterKickoff,
      }),
    ).rejects.toBeInstanceOf(SubmissionError);

    const reordered = await saveSubmissionPicks({
      contestId,
      universalProfileId: humanId,
      rankedEntryIds: [gibbsId, taylorId, bijanId, achaneId],
      now: afterKickoff,
    });
    expect(
      reordered.picks
        .sort((a, b) => a.predictedRank - b.predictedRank)
        .map((pick) => pick.rankableEntryId),
    ).toEqual([gibbsId, taylorId, bijanId, achaneId]);
    const gibbs = reordered.picks.find((pick) => pick.rankableEntryId === gibbsId);
    expect(gibbs?.slotLocked).toBe(true);
    expect(gibbs?.lockedRank).toBe(1);
  });

  it("does not let a complete unsubmitted draft compete after Sunday lock", async () => {
    const afterLock = zonedLocalToUtc(2026, 9, 13, 10, 1);
    await expect(
      saveSubmissionPicks({
        contestId,
        universalProfileId: humanId,
        rankedEntryIds: [gibbsId, taylorId, bijanId, achaneId],
        now: afterLock,
      }),
    ).rejects.toBeInstanceOf(SubmissionError);

    const draft = await prisma.rankingSubmission.findUniqueOrThrow({
      where: {
        contestId_universalProfileId: {
          contestId,
          universalProfileId: humanId,
        },
      },
    });
    expect(draft.status).toBe("DRAFT");
    expect(submissionIsEligible(draft.status)).toBe(false);
  });

  it("computes live RankIQ without overwriting official score", async () => {
    const beforeKickoff = zonedLocalToUtc(2026, 9, 10, 18, 0);
    await submitRanking({
      contestId,
      universalProfileId: humanId,
      rankedEntryIds: [gibbsId, taylorId, bijanId, achaneId],
      now: beforeKickoff,
    });
    await prisma.rankingSubmission.update({
      where: {
        contestId_universalProfileId: {
          contestId,
          universalProfileId: humanId,
        },
      },
      data: { status: "GRADED", normalizedScore: 41.5, rawScore: 100 },
    });
    await prisma.contestEntry.updateMany({
      where: { contestId, rankableEntryId: gibbsId },
      data: { fantasyPoints: 31.4 },
    });
    await prisma.contestEntry.updateMany({
      where: { contestId, rankableEntryId: taylorId },
      data: { fantasyPoints: 24.8 },
    });
    await prisma.contestEntry.updateMany({
      where: { contestId, rankableEntryId: bijanId },
      data: { fantasyPoints: 18.2 },
    });
    await prisma.contestEntry.updateMany({
      where: { contestId, rankableEntryId: achaneId },
      data: { fantasyPoints: 12.1 },
    });

    const live = await getLiveContestRankerBoard(contestId);
    expect(live[0]?.liveRankIqScore).toBeGreaterThan(0);

    const official = await prisma.rankingSubmission.findUniqueOrThrow({
      where: {
        contestId_universalProfileId: {
          contestId,
          universalProfileId: humanId,
        },
      },
    });
    expect(official.normalizedScore).toBe(41.5);
  });
});
