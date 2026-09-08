import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getContestConsensus } from "@/lib/consensus";
import { captureContestPregameSnapshotsForWeek } from "@/lib/consensus-snapshot";
import { rankingDepthForPosition } from "@/lib/contest-defaults";
import { prisma } from "@/lib/db";
import {
  canViewCurrentWeekConsensus,
  isConsensusPubliclyReleased,
} from "@/lib/timing/board-access";

const suffix = `adminprev${Date.now()}`;

describe("admin pre-reveal consensus preview", () => {
  let seasonId = "";
  let weekId = "";
  let contestId = "";
  let humanProfileId = "";
  let aiProfileId = "";
  let expertProfileId = "";
  let creatorProfileId = "";
  const playerIds: string[] = [];
  let preLockAt: Date;
  let lockAt: Date;
  let week: {
    id: string;
    fullLockAt: Date | null;
    status: string;
  };

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2098,
        sport: `TEST-ADMINPREV-${suffix}`,
        active: false,
      },
    });
    seasonId = season.id;

    lockAt = new Date("2098-09-14T15:00:00Z");
    preLockAt = new Date("2098-09-13T12:00:00Z");
    const createdWeek = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: "Week 1",
        startsAt: new Date("2098-09-07T00:00:00Z"),
        endsAt: new Date("2098-09-14T00:00:00Z"),
        status: "OPEN",
        fullLockAt: lockAt,
        rankingsOpenAt: new Date("2098-09-07T12:00:00Z"),
        revealStartsAt: lockAt,
        publicReleaseAt: lockAt,
      },
    });
    weekId = createdWeek.id;
    week = createdWeek;

    const contest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "WR",
        title: "Week 1 WR",
        rankingDepth: rankingDepthForPosition("WR"),
        status: "OPEN",
      },
    });
    contestId = contest.id;

    for (const name of ["Alpha", "Beta", "Gamma"]) {
      const player = await prisma.rankableEntry.create({
        data: {
          provider: "test",
          externalId: `adminprev-${name.toLowerCase()}-${suffix}`,
          type: "PLAYER",
          name,
          shortName: name,
          team: "MIN",
          opponent: "vs GB",
          position: "WR",
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
        displayName: "Human Prev",
        profileType: "HUMAN",
      },
    });
    humanProfileId = human.id;

    const ai = await prisma.universalProfile.create({
      data: {
        username: `ai-${suffix}`,
        displayName: "AI Prev",
        profileType: "AI",
      },
    });
    aiProfileId = ai.id;

    const expert = await prisma.universalProfile.create({
      data: {
        username: `expert-${suffix}`,
        displayName: "Expert Prev",
        profileType: "BENCHMARK",
      },
    });
    expertProfileId = expert.id;

    const creator = await prisma.universalProfile.create({
      data: {
        username: `creator-${suffix}`,
        displayName: "Creator Prev",
        profileType: "CREATOR",
      },
    });
    creatorProfileId = creator.id;

    async function createSubmission(
      profileId: string,
      ranks: string[],
      status: "SUBMITTED" | "LOCKED",
    ) {
      const submission = await prisma.rankingSubmission.create({
        data: {
          contestId,
          universalProfileId: profileId,
          status,
          submittedAt: preLockAt,
          lockedAt: status === "LOCKED" ? preLockAt : null,
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
    }

    // Production-like eligibility: Humans/AI SUBMITTED; Expert/Creator LOCKED captures.
    await createSubmission(humanProfileId, playerIds, "SUBMITTED");
    await createSubmission(
      aiProfileId,
      [playerIds[1]!, playerIds[0]!, playerIds[2]!],
      "SUBMITTED",
    );
    await createSubmission(expertProfileId, playerIds, "LOCKED");
    await createSubmission(
      creatorProfileId,
      [playerIds[2]!, playerIds[1]!, playerIds[0]!],
      "LOCKED",
    );
  });

  afterAll(async () => {
    await prisma.season.delete({ where: { id: seasonId } });
  });

  it("keeps humans and signed-out blocked before reveal", () => {
    expect(
      canViewCurrentWeekConsensus({
        week,
        viewer: { isAdmin: false },
        now: preLockAt,
      }),
    ).toBe(false);
    expect(
      canViewCurrentWeekConsensus({
        week,
        now: preLockAt,
      }),
    ).toBe(false);
    expect(
      isConsensusPubliclyReleased({
        week,
        now: preLockAt,
      }),
    ).toBe(false);
  });

  it("lets admin see every segment including group-weighted All", async () => {
    expect(
      canViewCurrentWeekConsensus({
        week,
        viewer: { isAdmin: true },
        now: preLockAt,
      }),
    ).toBe(true);

    const human = await getContestConsensus(contestId, "HUMAN", {
      preferLive: true,
    });
    const expert = await getContestConsensus(contestId, "EXPERT", {
      preferLive: true,
    });
    const creator = await getContestConsensus(contestId, "CREATOR", {
      preferLive: true,
    });
    const ai = await getContestConsensus(contestId, "AI", {
      preferLive: true,
    });
    const all = await getContestConsensus(contestId, "ALL", {
      preferLive: true,
    });

    expect(human.fromSnapshot).toBeUndefined();
    expect(human.sampleSize).toBe(1);
    expect(expert.sampleSize).toBe(1);
    expect(creator.sampleSize).toBe(1);
    expect(ai.sampleSize).toBe(1);
    expect(all.totalEntryCount).toBe(4);
    expect(all.contributingGroupCount).toBe(4);
    expect(all.sampleSize).toBe(4);
    expect(all.allConsensusMode).toBe("group_weighted");

    const alphaAll = all.entries.find(
      (row) => row.rankableEntryId === playerIds[0],
    );
    const alphaHuman = human.entries.find(
      (row) => row.rankableEntryId === playerIds[0],
    );
    const alphaExpert = expert.entries.find(
      (row) => row.rankableEntryId === playerIds[0],
    );
    const alphaCreator = creator.entries.find(
      (row) => row.rankableEntryId === playerIds[0],
    );
    const alphaAi = ai.entries.find(
      (row) => row.rankableEntryId === playerIds[0],
    );

    expect(alphaHuman?.selectionRate).toBe(1);
    expect(alphaExpert?.selectionRate).toBe(1);
    expect(alphaCreator?.selectionRate).toBe(1);
    expect(alphaAi?.selectionRate).toBe(1);
    expect(alphaAll?.selectionRate).toBeCloseTo(1, 5);
    expect(alphaAll?.averageSelectedRank).toBeCloseTo(
      ((alphaHuman?.averageSelectedRank ?? 0) +
        (alphaExpert?.averageSelectedRank ?? 0) +
        (alphaCreator?.averageSelectedRank ?? 0) +
        (alphaAi?.averageSelectedRank ?? 0)) /
        4,
      5,
    );
  });

  it("preferLive surfaces Expert/Creator/AI even when snapshot omits them", async () => {
    // Capture a human-only snapshot first by temporarily removing other ballots'
    // eligibility would be heavy — instead capture with current data, then add a
    // late Expert after snapshot and prove preferLive reads live.
    await captureContestPregameSnapshotsForWeek(weekId, lockAt);

    const lateExpert = await prisma.universalProfile.create({
      data: {
        username: `late-expert-${suffix}`,
        displayName: "Late Expert",
        profileType: "BENCHMARK",
      },
    });
    const lateSubmission = await prisma.rankingSubmission.create({
      data: {
        contestId,
        universalProfileId: lateExpert.id,
        status: "LOCKED",
        submittedAt: lockAt,
        lockedAt: lockAt,
      },
    });
    for (const [index, playerId] of playerIds.entries()) {
      await prisma.rankingPick.create({
        data: {
          submissionId: lateSubmission.id,
          rankableEntryId: playerId,
          predictedRank: index + 1,
        },
      });
    }

    const fromSnapshot = await getContestConsensus(contestId, "EXPERT");
    const fromLive = await getContestConsensus(contestId, "EXPERT", {
      preferLive: true,
    });

    expect(fromSnapshot.fromSnapshot).toBe(true);
    expect(fromSnapshot.sampleSize).toBe(1);
    expect(fromLive.fromSnapshot).toBeUndefined();
    expect(fromLive.sampleSize).toBe(2);
  });

  it("leaves post-reveal public access unchanged", () => {
    const afterLock = new Date(lockAt.getTime() + 60_000);
    expect(
      canViewCurrentWeekConsensus({
        week,
        viewer: { isAdmin: false },
        now: afterLock,
      }),
    ).toBe(true);
    expect(
      isConsensusPubliclyReleased({
        week,
        now: afterLock,
      }),
    ).toBe(true);
  });
});
