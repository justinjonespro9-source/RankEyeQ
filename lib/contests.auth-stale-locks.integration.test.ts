import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPublicPositionContest } from "@/lib/contests";
import { prisma } from "@/lib/db";
import {
  applyKickoffLocksToSubmission,
} from "@/lib/timing/apply-locks";
import {
  immutableLockedEntryIdsFromPicks,
  kickoffLockedEntryIdsFromMap,
} from "@/lib/timing/kickoff-locks";
import { zonedLocalToUtc } from "@/lib/timing/chicago";
import { computeNflTimingWindows } from "@/lib/timing/week-windows";

const suffix = `authlock${Date.now().toString(36)}`;
const week1Kickoff = zonedLocalToUtc(2026, 9, 7, 12, 0); // past
const week2Kickoff = zonedLocalToUtc(2026, 9, 20, 12, 0); // upcoming Sun
const timing = computeNflTimingWindows(
  zonedLocalToUtc(2026, 9, 17, 19, 15),
  week2Kickoff,
);

describe("authenticated stale W1 lock metadata vs week-scoped W2 matchups", () => {
  let priorActiveSeasonId: string | null = null;
  let seasonId = "";
  let week2Id = "";
  let contestId = "";
  let playerId = "";
  let humanId = "";
  let submissionId = "";
  let week2GameId = "";
  let rankedOrder: string[] = [];

  beforeAll(async () => {
    const prior = await prisma.season.findFirst({
      where: { active: true, sport: "NFL" },
      select: { id: true },
    });
    priorActiveSeasonId = prior?.id ?? null;
    if (priorActiveSeasonId) {
      await prisma.season.update({
        where: { id: priorActiveSeasonId },
        data: { active: false },
      });
    }

    const season = await prisma.season.create({
      data: { year: 2094, sport: "NFL", active: true },
    });
    seasonId = season.id;

    const week1 = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: "Week 1",
        startsAt: zonedLocalToUtc(2026, 9, 8, 0, 0),
        endsAt: zonedLocalToUtc(2026, 9, 15, 0, 0),
        status: "COMPLETE",
        isTest: false,
      },
    });

    const week2 = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 2,
        label: "Week 2",
        startsAt: zonedLocalToUtc(2026, 9, 15, 0, 0),
        endsAt: zonedLocalToUtc(2026, 9, 22, 0, 0),
        status: "OPEN",
        isTest: false,
        rankingsOpenAt: timing.rankingsOpenAt,
        fullLockAt: timing.fullLockAt,
        revealStartsAt: timing.revealStartsAt,
        publicReleaseAt: timing.publicReleaseAt,
      },
    });
    week2Id = week2.id;

    const week1Game = await prisma.nflGame.create({
      data: {
        provider: "test",
        externalId: `w1-atl-${suffix}`,
        seasonId,
        weekId: week1.id,
        seasonYear: 2094,
        weekNumber: 1,
        homeTeam: "ATL",
        awayTeam: "PIT",
        startsAt: week1Kickoff,
        status: "FINAL",
      },
    });

    const week2Game = await prisma.nflGame.create({
      data: {
        provider: "test",
        externalId: `w2-ne-${suffix}`,
        seasonId,
        weekId: week2Id,
        seasonYear: 2094,
        weekNumber: 2,
        homeTeam: "NE",
        awayTeam: "PIT",
        startsAt: week2Kickoff,
        status: "SCHEDULED",
      },
    });
    week2GameId = week2Game.id;

    // Extra W2 game for LAR fillers (matchup health / pool completeness)
    await prisma.nflGame.create({
      data: {
        provider: "test",
        externalId: `w2-lar-${suffix}`,
        seasonId,
        weekId: week2Id,
        seasonYear: 2094,
        weekNumber: 2,
        homeTeam: "LAR",
        awayTeam: "NYG",
        startsAt: week2Kickoff,
      },
    });

    const player = await prisma.rankableEntry.create({
      data: {
        provider: "test",
        externalId: `rodgers-${suffix}`,
        type: "PLAYER",
        name: `Aaron Rodgers ${suffix}`,
        shortName: "A. Rodgers",
        team: "PIT",
        position: "QB",
        availability: "ACTIVE",
        // Poisoned Week 1 master fields (what signed-in UI previously showed):
        gameId: week1Game.id,
        opponent: "vs ATL",
        gameStartsAt: week1Kickoff,
      },
    });
    playerId = player.id;

    const contest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId: week2Id,
        position: "QB",
        title: `QB auth ${suffix}`,
        rankingDepth: 10,
        reserveCount: 0,
        status: "OPEN",
      },
    });
    contestId = contest.id;

    const larGame = await prisma.nflGame.findFirstOrThrow({
      where: { weekId: week2Id, homeTeam: "LAR" },
    });

    await prisma.contestEntry.create({
      data: {
        contestId,
        rankableEntryId: playerId,
        gameId: week2GameId,
        excluded: false,
      },
    });

    const fillerIds: string[] = [];
    for (let i = 0; i < 9; i += 1) {
      const filler = await prisma.rankableEntry.create({
        data: {
          provider: "test",
          externalId: `afill-${i}-${suffix}`,
          type: "PLAYER",
          name: `Auth Filler ${i} ${suffix}`,
          shortName: `AF${i}`,
          team: "LAR",
          position: "QB",
          availability: "ACTIVE",
          opponent: "vs ATL",
          gameStartsAt: week1Kickoff,
        },
      });
      fillerIds.push(filler.id);
      await prisma.contestEntry.create({
        data: {
          contestId,
          rankableEntryId: filler.id,
          gameId: larGame.id,
          excluded: false,
        },
      });
    }

    rankedOrder = [playerId, ...fillerIds];

    const human = await prisma.universalProfile.create({
      data: {
        username: `alock_${suffix}`.slice(0, 24),
        displayName: "Auth Lock Human",
        profileType: "HUMAN",
      },
    });
    humanId = human.id;

    const submission = await prisma.rankingSubmission.create({
      data: {
        contestId,
        universalProfileId: humanId,
        status: "DRAFT",
        picks: {
          create: rankedOrder.map((rankableEntryId, index) => ({
            rankableEntryId,
            predictedRank: index + 1,
            // Stale W1 lock metadata — must not freeze upcoming W2 players
            slotLocked: true,
            lockedAt: week1Kickoff,
            lockedRank: index + 1,
            committedAt: week1Kickoff,
          })),
        },
      },
    });
    submissionId = submission.id;
  });

  afterAll(async () => {
    if (seasonId) {
      await prisma.rankingPick.deleteMany({
        where: { submission: { contest: { seasonId } } },
      });
      await prisma.rankingSubmission.deleteMany({
        where: { contest: { seasonId } },
      });
      await prisma.contestEntry.deleteMany({
        where: { contest: { seasonId } },
      });
      await prisma.rankIQContest.deleteMany({ where: { seasonId } });
      await prisma.rankableEntry.deleteMany({
        where: { externalId: { contains: suffix } },
      });
      await prisma.nflGame.deleteMany({ where: { seasonId } });
      await prisma.week.deleteMany({ where: { seasonId } });
      await prisma.season.delete({ where: { id: seasonId } }).catch(() => undefined);
    }
    if (priorActiveSeasonId) {
      await prisma.season.update({
        where: { id: priorActiveSeasonId },
        data: { active: true },
      });
    }
  });

  it("signed-out and signed-in share Week 2 matchup; stale locks heal before kickoff", async () => {
    const beforeKickoff = zonedLocalToUtc(2026, 9, 17, 12, 0);

    const signedOut = await getPublicPositionContest("qb");
    expect(signedOut.contestId).toBe(contestId);
    expect(signedOut.weekNumber).toBe(2);

    const poolPlayer = signedOut.players.find((p) => p.id === playerId);
    expect(poolPlayer?.opponent).toBe("@ NE");
    expect(poolPlayer?.opponent).not.toBe("vs ATL");
    expect(poolPlayer?.gameDay).toBe("Sun");

    const kickoffLocked = kickoffLockedEntryIdsFromMap(
      signedOut.kickoffByEntryId,
      beforeKickoff,
    );
    expect(kickoffLocked).not.toContain(playerId);

    // Authenticated read path heals premature locks without deleting the draft.
    const healed = await applyKickoffLocksToSubmission(
      submissionId,
      beforeKickoff,
    );
    expect(healed).toBeTruthy();

    const picks = await prisma.rankingPick.findMany({
      where: { submissionId },
      orderBy: { predictedRank: "asc" },
    });
    expect(picks.map((p) => p.rankableEntryId)).toEqual(rankedOrder);
    expect(picks.every((p) => p.slotLocked === false)).toBe(true);

    const immutable = immutableLockedEntryIdsFromPicks({
      picks,
      kickoffByEntryId: signedOut.kickoffByEntryId,
      now: beforeKickoff,
      fullBoardLocked: false,
    });
    expect(immutable).not.toContain(playerId);
    expect(immutable).toHaveLength(0);

    // Same contest matchup for "signed-in" display source (pool, not RankableEntry).
    expect(poolPlayer?.opponent).toBe("@ NE");
  });

  it("keeps legitimate locks after the actual Week 2 kickoff", async () => {
    const afterKickoff = zonedLocalToUtc(2026, 9, 20, 13, 0);

    // Re-apply stale W1 lock flags, then apply after real W2 kickoff.
    await prisma.rankingPick.updateMany({
      where: { submissionId },
      data: {
        slotLocked: false,
        lockedAt: null,
        lockedRank: null,
      },
    });

    await applyKickoffLocksToSubmission(submissionId, afterKickoff);

    const picks = await prisma.rankingPick.findMany({
      where: { submissionId },
      orderBy: { predictedRank: "asc" },
    });
    const playerPick = picks.find((p) => p.rankableEntryId === playerId);
    expect(playerPick?.slotLocked).toBe(true);
    expect(picks.map((p) => p.rankableEntryId)).toEqual(rankedOrder);

    const data = await getPublicPositionContest("qb");
    const immutable = immutableLockedEntryIdsFromPicks({
      picks,
      kickoffByEntryId: data.kickoffByEntryId,
      now: afterKickoff,
      fullBoardLocked: false,
    });
    expect(immutable).toContain(playerId);
  });
});
