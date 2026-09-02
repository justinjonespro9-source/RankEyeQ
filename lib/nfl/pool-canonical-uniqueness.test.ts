import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  findWeeklyPoolCanonicalDuplicates,
  validateWeeklyPoolCanonicalUniqueness,
} from "@/lib/nfl/pool-canonical-uniqueness";

const suffix = `pool${Date.now()}`;

describe("weekly pool canonical uniqueness", () => {
  let weekId = "";
  let contestId = "";
  let seasonId = "";

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2093,
        sport: `TEST-POOL-${suffix}`,
        active: false,
      },
    });
    seasonId = season.id;
    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: "Week 1",
        startsAt: new Date("2093-09-07T00:00:00Z"),
        endsAt: new Date("2093-09-14T00:00:00Z"),
        status: "OPEN",
      },
    });
    weekId = week.id;
    const contest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "WR",
        title: "Week 1 WR",
        rankingDepth: 10,
        status: "DRAFT",
      },
    });
    contestId = contest.id;

    const canonical = await prisma.rankableEntry.create({
      data: {
        provider: "nflcom-bootstrap",
        externalId: `dup-test-${suffix}`,
        type: "PLAYER",
        name: "Pool Dup Player",
        shortName: "Player",
        team: "NE",
        position: "WR",
        opponent: "TBD",
        active: true,
      },
    });
    const legacy = await prisma.rankableEntry.create({
      data: {
        provider: "mock",
        externalId: `mock-dup-${suffix}`,
        type: "PLAYER",
        name: "Pool Dup Player",
        shortName: "Player",
        team: "PHI",
        position: "WR",
        opponent: "TBD",
        active: true,
      },
    });

    await prisma.contestEntry.createMany({
      data: [
        {
          contestId,
          rankableEntryId: canonical.id,
          weekTeam: "NE",
          excluded: false,
        },
        {
          contestId,
          rankableEntryId: legacy.id,
          weekTeam: "PHI",
          excluded: false,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.season.deleteMany({ where: { id: seasonId } });
  });

  it("detects duplicate canonical players in a weekly pool", async () => {
    const duplicates = await findWeeklyPoolCanonicalDuplicates(weekId);
    expect(duplicates.length).toBeGreaterThan(0);
    const validation = await validateWeeklyPoolCanonicalUniqueness(weekId);
    expect(validation.ok).toBe(false);
  });
});
