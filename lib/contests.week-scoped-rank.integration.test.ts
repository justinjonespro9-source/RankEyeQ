import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPublicPositionContest } from "@/lib/contests";
import { prisma } from "@/lib/db";
import {
  saveSubmissionPicks,
} from "@/lib/submissions";
import { kickoffLockedEntryIdsFromMap } from "@/lib/timing/kickoff-locks";
import { zonedLocalToUtc } from "@/lib/timing/chicago";
import { computeNflTimingWindows } from "@/lib/timing/week-windows";

const suffix = `w2rank${Date.now().toString(36)}`;
const week1Kickoff = zonedLocalToUtc(2026, 9, 10, 19, 20); // Thu — already played
const week2Kickoff = zonedLocalToUtc(2026, 9, 20, 12, 0); // Sun noon CDT — upcoming
const timing = computeNflTimingWindows(
  zonedLocalToUtc(2026, 9, 17, 19, 15),
  week2Kickoff,
);

describe("Week 2 ranking path ignores poisoned Week 1 RankableEntry matchups", () => {
  let priorActiveSeasonId: string | null = null;
  let seasonId = "";
  let week1Id = "";
  let week2Id = "";
  let contestId = "";
  let playerId = "";
  let humanId = "";
  let week2GameId = "";

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
      data: {
        year: 2093,
        sport: "NFL",
        active: true,
      },
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
    week1Id = week1.id;

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
        externalId: `w1-${suffix}`,
        seasonId,
        weekId: week1Id,
        seasonYear: 2093,
        weekNumber: 1,
        homeTeam: "SF",
        awayTeam: "SEA",
        startsAt: week1Kickoff,
        status: "FINAL",
      },
    });

    const week2Game = await prisma.nflGame.create({
      data: {
        provider: "test",
        externalId: `w2-${suffix}`,
        seasonId,
        weekId: week2Id,
        seasonYear: 2093,
        weekNumber: 2,
        homeTeam: "SF",
        awayTeam: "PHI",
        startsAt: week2Kickoff,
        status: "SCHEDULED",
      },
    });
    week2GameId = week2Game.id;

    // Extra Week 2 games so assertWeekMatchupsStamped sees a full-enough slate
    // (health requires games present; exact 16 not required if stamp check only needs >0 ready).
    for (const [away, home] of [
      ["NYG", "LAR"],
      ["MIA", "BUF"],
      ["DAL", "NYJ"],
    ] as const) {
      await prisma.nflGame.create({
        data: {
          provider: "test",
          externalId: `w2-extra-${away}-${suffix}`,
          seasonId,
          weekId: week2Id,
          seasonYear: 2093,
          weekNumber: 2,
          homeTeam: home,
          awayTeam: away,
          startsAt: week2Kickoff,
        },
      });
    }

    const player = await prisma.rankableEntry.create({
      data: {
        provider: "test",
        externalId: `purdy-${suffix}`,
        type: "PLAYER",
        name: `Brock Purdy ${suffix}`,
        shortName: "B. Purdy",
        team: "SF",
        position: "QB",
        availability: "ACTIVE",
        // Deliberately poisoned Week 1 master fields:
        gameId: week1Game.id,
        opponent: "vs SEA",
        gameStartsAt: week1Kickoff,
      },
    });
    playerId = player.id;

    const contest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId: week2Id,
        position: "QB",
        title: `QB ${suffix}`,
        rankingDepth: 10,
        reserveCount: 0,
        status: "OPEN",
      },
    });
    contestId = contest.id;

    const larGame = await prisma.nflGame.findFirstOrThrow({
      where: { weekId: week2Id, homeTeam: "LAR" },
    });

    // Fill ranking depth with this player + fillers so submission can complete a board
    await prisma.contestEntry.create({
      data: {
        contestId,
        rankableEntryId: playerId,
        gameId: week2GameId,
        excluded: false,
      },
    });

    for (let i = 0; i < 9; i += 1) {
      const filler = await prisma.rankableEntry.create({
        data: {
          provider: "test",
          externalId: `fill-${i}-${suffix}`,
          type: "PLAYER",
          name: `Filler ${i} ${suffix}`,
          shortName: `F${i}`,
          team: "LAR",
          position: "QB",
          availability: "ACTIVE",
          opponent: "vs SEA",
          gameStartsAt: week1Kickoff,
        },
      });
      await prisma.contestEntry.create({
        data: {
          contestId,
          rankableEntryId: filler.id,
          gameId: larGame.id,
          excluded: false,
        },
      });
    }

    const human = await prisma.universalProfile.create({
      data: {
        username: `w2rank_${suffix}`.slice(0, 24),
        displayName: "W2 Rank Human",
        profileType: "HUMAN",
      },
    });
    humanId = human.id;
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

  it("displays Week 2 opponent/kickoff despite poisoned Week 1 RankableEntry", async () => {
    const data = await getPublicPositionContest("qb");
    expect(data.weekId).toBe(week2Id);
    expect(data.weekNumber).toBe(2);
    expect(data.challenge.weekLabel).toBe("Week 2");
    expect(data.contestId).toBe(contestId);

    const player = data.players.find((p) => p.id === playerId);
    expect(player).toBeTruthy();
    expect(player!.opponent).toBe("vs PHI");
    expect(player!.gameDay).toBe("Sun");
    expect(player!.opponent).not.toBe("vs SEA");

    const now = zonedLocalToUtc(2026, 9, 17, 12, 0); // before Week 2 kickoff
    const locked = kickoffLockedEntryIdsFromMap(data.kickoffByEntryId, now);
    expect(locked).not.toContain(playerId);
    expect(data.kickoffByEntryId[playerId]).toBe(week2Kickoff.toISOString());
  });

  it("allows submission before Week 2 kickoff", async () => {
    const pool = await prisma.contestEntry.findMany({
      where: { contestId, excluded: false },
      orderBy: { rankableEntry: { name: "asc" } },
      take: 10,
      select: { rankableEntryId: true },
    });
    const ranked = pool.map((e) => e.rankableEntryId);
    expect(ranked).toHaveLength(10);
    expect(ranked).toContain(playerId);

    const beforeKickoff = zonedLocalToUtc(2026, 9, 17, 12, 0);
    const result = await saveSubmissionPicks({
      contestId,
      universalProfileId: humanId,
      rankedEntryIds: ranked,
      requireComplete: true,
      now: beforeKickoff,
    });
    expect(result.id).toBeTruthy();

    const picks = await prisma.rankingPick.findMany({
      where: { submissionId: result.id },
    });
    const playerPick = picks.find((p) => p.rankableEntryId === playerId);
    expect(playerPick?.slotLocked).toBe(false);
  });
});
