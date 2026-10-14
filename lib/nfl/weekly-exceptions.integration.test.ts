import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { enrollSeasonPlayer } from "@/lib/season-players";
import { getWeeklyExceptionReview } from "@/lib/nfl/weekly-exceptions";

const suffix = `wx${Date.now()}`;

describe("weekly exception review — missing pool entries", () => {
  let seasonId = "";
  let weekId = "";
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: { year: 2098, sport: `TEST-SEASON-${suffix}`, active: false },
    });
    seasonId = season.id;
    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: "Week 1",
        startsAt: new Date("2098-09-07T00:00:00Z"),
        endsAt: new Date("2098-09-14T00:00:00Z"),
        status: "UPCOMING",
        isTest: true,
      },
    });
    weekId = week.id;
    const game = await prisma.nflGame.create({
      data: {
        provider: "test",
        externalId: `game-${suffix}`,
        seasonId,
        weekId,
        seasonYear: 2098,
        weekNumber: 1,
        homeTeam: "MIN",
        awayTeam: "GB",
        startsAt: new Date("2098-09-07T17:00:00Z"),
      },
    });
    const contest = await prisma.rankIQContest.create({
      data: { seasonId, weekId, position: "RB", title: "Week 1 RB Top 10", rankingDepth: 10, status: "DRAFT" },
    });

    const players: Array<[key: string, nflStatus: string, activeOnNFLRoster: boolean]> = [
      ["pooled", "ACTIVE", true],
      ["activeMissing", "ACTIVE", true],
      ["practiceSquad", "PRACTICE_SQUAD", false],
      ["injuredReserve", "IR", false],
      ["rosteredIr", "IR", true],
    ];
    for (const [key, nflStatus, activeOnNFLRoster] of players) {
      const entry = await prisma.rankableEntry.create({
        data: {
          provider: "test",
          externalId: `${key}-${suffix}`,
          type: "PLAYER",
          name: `Exception ${key}`,
          shortName: key,
          team: "MIN",
          opponent: "vs GB",
          position: "RB",
          active: true,
        },
      });
      ids[key] = entry.id;
      await enrollSeasonPlayer({ seasonId, rankableEntryId: entry.id, nflStatus, activeOnNFLRoster });
    }
    await prisma.contestEntry.create({
      data: { contestId: contest.id, rankableEntryId: ids.pooled!, gameId: game.id, weekTeam: "MIN" },
    });
  });

  afterAll(async () => {
    await prisma.contestEntry.deleteMany({ where: { contest: { seasonId } } });
    await prisma.rankIQContest.deleteMany({ where: { seasonId } });
    await prisma.nflGame.deleteMany({ where: { provider: "test", externalId: { contains: suffix } } });
    await prisma.week.deleteMany({ where: { seasonId } });
    await prisma.seasonPlayer.deleteMany({ where: { seasonId } });
    await prisma.rankableEntry.deleteMany({ where: { externalId: { contains: suffix } } });
    await prisma.season.delete({ where: { id: seasonId } });
  });

  it("flags only roster-eligible players without a weekly entry", async () => {
    const review = await getWeeklyExceptionReview(weekId);
    const missing = review.exceptions
      .filter((row) => row.kind === "missing_pool_entry")
      .map((row) => row.rankableEntryId);

    expect(missing).toEqual([ids.activeMissing]);
    expect(review.summary.missingEntries).toBe(1);
  });
});
