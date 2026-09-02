import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getContestConsensus } from "@/lib/consensus";
import { captureContestPregameSnapshotsForWeek } from "@/lib/consensus-snapshot";
import { rankingDepthForPosition } from "@/lib/contest-defaults";

const suffix = `snap${Date.now()}`;

describe("pregame snapshot immutability", () => {
  let seasonId = "";
  let weekId = "";
  let contestId = "";
  let humanProfileId = "";
  let aiProfileId = "";
  let expertProfileId = "";
  const playerIds: string[] = [];
  let lockAt: Date;

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2097,
        sport: `TEST-SNAP-${suffix}`,
        active: false,
      },
    });
    seasonId = season.id;

    lockAt = new Date("2097-09-14T15:00:00Z");
    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 3,
        label: "Week 3",
        startsAt: new Date("2097-09-07T00:00:00Z"),
        endsAt: new Date("2097-09-14T00:00:00Z"),
        status: "LOCKED",
        fullLockAt: lockAt,
        rankingsOpenAt: new Date("2097-09-07T12:00:00Z"),
        revealStartsAt: lockAt,
        publicReleaseAt: new Date(lockAt.getTime() + 3600000),
      },
    });
    weekId = week.id;

    const contest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "RB",
        title: "Week 3 RB",
        rankingDepth: rankingDepthForPosition("RB"),
        status: "LOCKED",
      },
    });
    contestId = contest.id;

    for (const name of ["Alpha", "Beta", "Gamma"]) {
      const player = await prisma.rankableEntry.create({
        data: {
          provider: "test",
          externalId: `snap-${name.toLowerCase()}-${suffix}`,
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
        },
      });
    }

    const human = await prisma.universalProfile.create({
      data: {
        username: `human-${suffix}`,
        displayName: "Human Snap",
        profileType: "HUMAN",
      },
    });
    humanProfileId = human.id;

    const ai = await prisma.universalProfile.create({
      data: {
        username: `ai-${suffix}`,
        displayName: "AI Snap",
        profileType: "AI",
      },
    });
    aiProfileId = ai.id;

    const expert = await prisma.universalProfile.create({
      data: {
        username: `expert-${suffix}`,
        displayName: "Expert Snap",
        profileType: "BENCHMARK",
      },
    });
    expertProfileId = expert.id;

  async function createSubmission(
    profileId: string,
    ranks: string[],
  ) {
    const submission = await prisma.rankingSubmission.create({
      data: {
        contestId,
        universalProfileId: profileId,
        status: "LOCKED",
        lockedAt: lockAt,
        submittedAt: new Date("2097-09-14T14:00:00Z"),
      },
    });
    for (const [index, playerId] of ranks.entries()) {
      await prisma.rankingPick.create({
        data: {
          submissionId: submission.id,
          rankableEntryId: playerId,
          predictedRank: index + 1,
        },
      });
    }
    return submission.id;
  }

    await createSubmission(humanProfileId, playerIds);
    await createSubmission(aiProfileId, [playerIds[1], playerIds[0], playerIds[2]]);
    await createSubmission(expertProfileId, playerIds);

    await captureContestPregameSnapshotsForWeek(weekId, lockAt);
  });

  afterAll(async () => {
    await prisma.season.delete({ where: { id: seasonId } });
  });

  it("freezes segment sample sizes and selection metrics at lock", async () => {
    const humanBefore = await getContestConsensus(contestId, "HUMAN");
    const expertBefore = await getContestConsensus(contestId, "EXPERT");
    const allBefore = await getContestConsensus(contestId, "ALL");

    expect(humanBefore.fromSnapshot).toBe(true);
    expect(humanBefore.sampleSize).toBe(1);
    expect(expertBefore.sampleSize).toBe(1);
    expect(allBefore.sampleSize).toBeGreaterThanOrEqual(2);

    const alphaHuman = humanBefore.entries.find(
      (row) => row.rankableEntryId === playerIds[0],
    );
    expect(alphaHuman?.selectionRate).toBe(1);
    expect(alphaHuman?.averageSelectedRank).toBe(1);

    const expertEmpty = expertBefore.entries.find(
      (row) => row.rankableEntryId === playerIds[0],
    );
    expect(expertEmpty?.selectionRate).toBe(1);

    const humanSubmission = await prisma.rankingSubmission.findFirstOrThrow({
      where: { contestId, universalProfileId: humanProfileId },
      include: { picks: true },
    });
    const pickAt1 = humanSubmission.picks.find((pick) => pick.predictedRank === 1);
    const pickAt3 = humanSubmission.picks.find((pick) => pick.predictedRank === 3);
    if (pickAt1 && pickAt3) {
      await prisma.rankingPick.update({
        where: { id: pickAt1.id },
        data: { predictedRank: 99 },
      });
      await prisma.rankingPick.update({
        where: { id: pickAt3.id },
        data: { predictedRank: 1 },
      });
      await prisma.rankingPick.update({
        where: { id: pickAt1.id },
        data: { predictedRank: 3 },
      });
    }

    const humanAfter = await getContestConsensus(contestId, "HUMAN");
    const alphaAfter = humanAfter.entries.find(
      (row) => row.rankableEntryId === playerIds[0],
    );

    expect(humanAfter.fromSnapshot).toBe(true);
    expect(alphaAfter?.averageSelectedRank).toBe(1);
    expect(alphaAfter?.selectionRate).toBe(1);
    expect(humanAfter.sampleSize).toBe(1);
  });
});
