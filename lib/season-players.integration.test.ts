import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { aggregatePlayerPerformance } from "@/lib/player-performance";
import { getPlayerPerformanceLeaderboard } from "@/lib/player-performance-queries";
import { enrollSeasonPlayer } from "@/lib/season-players";
import {
  deactivateWeeklyPlayer,
  suggestWeeklyPoolFromSeason,
} from "@/lib/nfl/weekly-eligibility";

const suffix = `sp${Date.now()}`;

describe("season player universe and weekly eligibility", () => {
  let seasonId = "";
  let week1Id = "";
  let week2Id = "";
  let jonesId = "";
  let masonId = "";
  let claireId = "";

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2098,
        sport: `TEST-SEASON-${suffix}`,
        active: false,
      },
    });
    seasonId = season.id;

    const week1 = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: "Week 1",
        startsAt: new Date("2098-09-07T00:00:00Z"),
        endsAt: new Date("2098-09-14T00:00:00Z"),
        status: "OPEN",
        isTest: true,
      },
    });
    week1Id = week1.id;

    const week2 = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 2,
        label: "Week 2",
        startsAt: new Date("2098-09-14T00:00:00Z"),
        endsAt: new Date("2098-09-21T00:00:00Z"),
        status: "OPEN",
        isTest: true,
      },
    });
    week2Id = week2.id;

    await prisma.nflGame.createMany({
      data: [
        {
          provider: "test",
          externalId: `game-w1-${suffix}`,
          seasonId,
          weekId: week1Id,
          seasonYear: 2098,
          weekNumber: 1,
          homeTeam: "MIN",
          awayTeam: "GB",
          startsAt: new Date("2098-09-07T17:00:00Z"),
        },
        {
          provider: "test",
          externalId: `game-w2-${suffix}`,
          seasonId,
          weekId: week2Id,
          seasonYear: 2098,
          weekNumber: 2,
          homeTeam: "MIN",
          awayTeam: "CHI",
          startsAt: new Date("2098-09-14T17:00:00Z"),
        },
      ],
    });

    const createPlayer = async (name: string, externalId: string) =>
      prisma.rankableEntry.create({
        data: {
          provider: "test",
          externalId: `${externalId}-${suffix}`,
          type: "PLAYER",
          name,
          shortName: name.split(" ")[0] ?? name,
          team: "MIN",
          opponent: "vs GB",
          position: "RB",
          active: true,
        },
      });

    jonesId = (await createPlayer("Aaron Jones Sr.", "jones")).id;
    masonId = (await createPlayer("Jordan Mason", "mason")).id;
    claireId = (await createPlayer("Demond Claiborne", "claire")).id;

    for (const playerId of [jonesId, masonId, claireId]) {
      await enrollSeasonPlayer({ seasonId, rankableEntryId: playerId });
    }

    await suggestWeeklyPoolFromSeason({
      weekId: week1Id,
      position: "RB",
      scheduledTeamsOnly: false,
    });

    const week1Contest = await prisma.rankIQContest.findUniqueOrThrow({
      where: { weekId_position: { weekId: week1Id, position: "RB" } },
      include: { entries: true },
    });

    const claireWeek1 = week1Contest.entries.find(
      (entry) => entry.rankableEntryId === claireId,
    );
    expect(claireWeek1?.excluded).toBe(false);

    await deactivateWeeklyPlayer({
      contestEntryId: claireWeek1!.id,
      inactiveReason: "test scenario — not expected to play week 1",
    });

    for (const entry of week1Contest.entries) {
      if (!entry.excluded && entry.rankableEntryId === jonesId) {
        await prisma.contestEntry.update({
          where: { id: entry.id },
          data: { actualRank: 7, fantasyPoints: 14.2 },
        });
      }
      if (!entry.excluded && entry.rankableEntryId === masonId) {
        await prisma.contestEntry.update({
          where: { id: entry.id },
          data: { actualRank: 3, fantasyPoints: 18.1 },
        });
      }
    }

    await prisma.rankIQContest.update({
      where: { id: week1Contest.id },
      data: { status: "FINAL" },
    });

    await suggestWeeklyPoolFromSeason({
      weekId: week2Id,
      position: "RB",
      scheduledTeamsOnly: false,
    });

    const week2Contest = await prisma.rankIQContest.findUniqueOrThrow({
      where: { weekId_position: { weekId: week2Id, position: "RB" } },
      include: { entries: true },
    });

    const claireEntry = week2Contest.entries.find(
      (entry) => entry.rankableEntryId === claireId,
    );
    expect(claireEntry?.excluded).toBe(false);

    await prisma.contestEntry.update({
      where: { id: claireEntry!.id },
      data: { actualRank: 5, fantasyPoints: 11.4, weekTeam: "MIN" },
    });

    await prisma.rankIQContest.update({
      where: { id: week2Contest.id },
      data: { status: "FINAL" },
    });

    await prisma.seasonPlayer.update({
      where: {
        seasonId_rankableEntryId: { seasonId, rankableEntryId: jonesId },
      },
      data: { team: "GB", activeOnNFLRoster: false },
    });
  });

  afterAll(async () => {
    await prisma.contestEntry.deleteMany({
      where: { contest: { seasonId } },
    });
    await prisma.rankIQContest.deleteMany({ where: { seasonId } });
    await prisma.nflGame.deleteMany({
      where: { provider: "test", externalId: { contains: suffix } },
    });
    await prisma.week.deleteMany({ where: { seasonId } });
    await prisma.seasonPlayer.deleteMany({ where: { seasonId } });
    await prisma.rankableEntry.deleteMany({
      where: { externalId: { contains: suffix } },
    });
    await prisma.season.delete({ where: { id: seasonId } });
  });

  it("allows admin exclusion while keeping season universe membership", async () => {
    const claireSeason = await prisma.seasonPlayer.findUniqueOrThrow({
      where: {
        seasonId_rankableEntryId: { seasonId, rankableEntryId: claireId },
      },
    });
    expect(claireSeason.displayName).toContain("Claiborne");

    const week1Entry = await prisma.contestEntry.findFirst({
      where: {
        rankableEntryId: claireId,
        contest: { weekId: week1Id },
      },
    });
    expect(week1Entry?.excluded).toBe(true);
    expect(week1Entry?.inactiveReason).toContain("week 1");
  });

  it("activates a player in week 2 after being inactive in week 1", async () => {
    const week2Entry = await prisma.contestEntry.findFirstOrThrow({
      where: {
        rankableEntryId: claireId,
        contest: { weekId: week2Id },
      },
    });
    expect(week2Entry.excluded).toBe(false);
    expect(week2Entry.actualRank).toBe(5);
  });

  it("preserves historical weekly results after a trade or release", async () => {
    const jonesWeek1 = await prisma.contestEntry.findFirstOrThrow({
      where: {
        rankableEntryId: jonesId,
        contest: { weekId: week1Id },
      },
    });
    expect(jonesWeek1.weekTeam).toBe("MIN");
    expect(jonesWeek1.actualRank).toBe(7);

    const jonesSeason = await prisma.seasonPlayer.findUniqueOrThrow({
      where: {
        seasonId_rankableEntryId: { seasonId, rankableEntryId: jonesId },
      },
    });
    expect(jonesSeason.team).toBe("GB");
    expect(jonesSeason.activeOnNFLRoster).toBe(false);
  });

  it("builds player performance leaderboard from finalized weekly finishes", async () => {
    const { rows: leaderboard } = await getPlayerPerformanceLeaderboard({
      seasonId,
      position: "RB",
      qualification: "ALL",
      sort: "averageFinish",
      sortDirection: "asc",
      includeTest: true,
    });

    const jones = leaderboard.find((row) => row.rankableEntryId === jonesId);
    const mason = leaderboard.find((row) => row.rankableEntryId === masonId);
    const claire = leaderboard.find((row) => row.rankableEntryId === claireId);

    expect(jones?.weeksRecorded).toBe(1);
    expect(jones?.averageFinish).toBe(7);
    expect(mason?.averageFinish).toBe(3);
    expect(claire?.weeksEligible).toBe(1);
    expect(claire?.averageFinish).toBe(5);

    expect(leaderboard[0]?.rankableEntryId).toBe(masonId);
  });
});

describe("aggregatePlayerPerformance sorting and qualification", () => {
  it("applies minimum week qualification thresholds", () => {
    const rows = [
      {
        rankableEntryId: "a",
        name: "A",
        team: "MIN",
        position: "RB" as const,
        weekId: "w1",
        weekLabel: "Week 1",
        weekNumber: 1,
        contestId: "c1",
        weekTeam: "MIN",
        actualRank: 2,
        fantasyPoints: 10,
        wasActive: true,
        contestFinal: true,
        consensusRank: null,
      },
    ];

    expect(
      aggregatePlayerPerformance(rows, {
        position: "RB",
        qualification: "MIN_4",
      }),
    ).toHaveLength(0);

    expect(
      aggregatePlayerPerformance(rows, {
        position: "RB",
        qualification: "MIN_4",
        sort: "averageFinish",
        sortDirection: "asc",
      }),
    ).toHaveLength(0);
  });
});
