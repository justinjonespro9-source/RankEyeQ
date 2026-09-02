import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { rankableEntryToRankingPlayer } from "@/lib/rankable-mappers";
import { enrollSeasonPlayer, syncSeasonPlayersFromDirectory } from "@/lib/season-players";
import { syncWeeklyEligibleFieldFromSeason } from "@/lib/nfl/weekly-eligibility";
import {
  dedupeRankingPlayersByIdentity,
  validateWeeklyPoolCanonicalUniqueness,
} from "@/lib/nfl/pool-canonical-uniqueness";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";

const suffix = `picker-dup-${Date.now()}`;

describe("picker duplicate regression", () => {
  let seasonId = "";
  let weekId = "";

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2090,
        sport: `TEST-PICKER-${suffix}`,
        active: false,
      },
    });
    seasonId = season.id;
    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: `Week 1 ${suffix}`,
        startsAt: new Date("2090-09-07T00:00:00Z"),
        endsAt: new Date("2090-09-14T00:00:00Z"),
        status: "OPEN",
        isTest: false,
      },
    });
    weekId = week.id;
    await prisma.nflGame.create({
      data: {
        provider: "test",
        externalId: `game-${suffix}`,
        seasonId,
        weekId,
        seasonYear: 2090,
        weekNumber: 1,
        homeTeam: "MIN",
        awayTeam: "GB",
        startsAt: new Date("2090-09-07T17:00:00Z"),
      },
    });
    await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "RB",
        title: "RB",
        rankingDepth: 10,
        status: "OPEN",
      },
    });
  });

  afterAll(async () => {
    await prisma.season.delete({ where: { id: seasonId } });
  });

  it("does not reintroduce merge-compatible duplicates after season sync + weekly sync", async () => {
    const canonical = await prisma.rankableEntry.create({
      data: {
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: `aaron-jones-${suffix}`,
        type: "PLAYER",
        name: "Aaron Jones",
        shortName: "Jones",
        team: "MIN",
        position: "RB",
        opponent: "TBD",
        active: true,
      },
    });
    const legacy = await prisma.rankableEntry.create({
      data: {
        provider: "manual",
        externalId: `manual-aaron-jones-${suffix}`,
        type: "PLAYER",
        name: "Aaron Jones Sr.",
        shortName: "Jones",
        team: "MIN",
        position: "RB",
        opponent: "TBD",
        active: true,
      },
    });

    await enrollSeasonPlayer({
      seasonId,
      rankableEntryId: canonical.id,
      team: "MIN",
      activeOnNFLRoster: true,
    });
    await enrollSeasonPlayer({
      seasonId,
      rankableEntryId: legacy.id,
      team: "MIN",
      activeOnNFLRoster: true,
    });

    await prisma.contestEntry.createMany({
      data: [
        {
          contestId: (
            await prisma.rankIQContest.findUniqueOrThrow({
              where: { weekId_position: { weekId, position: "RB" } },
            })
          ).id,
          rankableEntryId: canonical.id,
          weekTeam: "MIN",
          excluded: false,
        },
        {
          contestId: (
            await prisma.rankIQContest.findUniqueOrThrow({
              where: { weekId_position: { weekId, position: "RB" } },
            })
          ).id,
          rankableEntryId: legacy.id,
          weekTeam: "MIN",
          excluded: false,
        },
      ],
    });

    await syncSeasonPlayersFromDirectory({
      seasonId,
      position: "RB",
      rankableEntryIds: [canonical.id],
    });
    await syncWeeklyEligibleFieldFromSeason({
      weekId,
      position: "RB",
      scheduledTeamsOnly: true,
    });

    const validation = await validateWeeklyPoolCanonicalUniqueness(weekId);
    expect(validation.blockers, validation.blockers.join(" | ")).toEqual([]);
    expect(validation.ok).toBe(true);

    const contest = await prisma.rankIQContest.findUniqueOrThrow({
      where: { weekId_position: { weekId, position: "RB" } },
      include: {
        entries: {
          where: { excluded: false },
          include: { rankableEntry: true },
        },
      },
    });
    const players = contest.entries.map((entry) =>
      rankableEntryToRankingPlayer(entry.rankableEntry),
    );
    const metaById = new Map(
      contest.entries.map((entry) => [
        entry.rankableEntryId,
        {
          provider: entry.rankableEntry.provider,
          externalId: entry.rankableEntry.externalId,
          position: entry.rankableEntry.position,
          type: entry.rankableEntry.type,
        },
      ]),
    );
    const deduped = dedupeRankingPlayersByIdentity(players, metaById);
    const aaronRows = deduped.filter((player) => /aaron jones/i.test(player.name));
    expect(aaronRows).toHaveLength(1);

    const activeEntry = await prisma.contestEntry.findFirst({
      where: {
        excluded: false,
        contest: { weekId, position: "RB" },
        rankableEntry: { provider: NFL_COM_BOOTSTRAP_PROVIDER, externalId: `aaron-jones-${suffix}` },
      },
    });
    expect(activeEntry?.rankableEntryId).toBe(canonical.id);

    const activeEntries = await prisma.contestEntry.count({
      where: {
        excluded: false,
        contest: { weekId, position: "RB" },
        rankableEntry: {
          OR: [
            { id: canonical.id },
            { id: legacy.id },
          ],
        },
      },
    });
    expect(activeEntries).toBe(1);
  });

  it("excludes duplicate nflcom merge-test identities with the same display name", async () => {
    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 2,
        label: `Week 2 ${suffix}`,
        startsAt: new Date("2090-09-14T00:00:00Z"),
        endsAt: new Date("2090-09-21T00:00:00Z"),
        status: "OPEN",
        isTest: false,
      },
    });
    await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId: week.id,
        position: "RB",
        title: "RB2",
        rankingDepth: 10,
        status: "OPEN",
      },
    });

    const canonical = await prisma.rankableEntry.create({
      data: {
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: `brian-robinson-${suffix}`,
        type: "PLAYER",
        name: "Brian Robinson",
        shortName: "Robinson",
        team: "ATL",
        position: "RB",
        opponent: "TBD",
        active: true,
      },
    });
    const artifact = await prisma.rankableEntry.create({
      data: {
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: `brian-robinson-br-merge-${suffix}`,
        type: "PLAYER",
        name: "Brian Robinson",
        shortName: "Robinson",
        team: "ATL",
        position: "RB",
        opponent: "TBD",
        active: true,
      },
    });

    for (const id of [canonical.id, artifact.id]) {
      await enrollSeasonPlayer({
        seasonId,
        rankableEntryId: id,
        team: "ATL",
        activeOnNFLRoster: true,
      });
    }

    const contest = await prisma.rankIQContest.findUniqueOrThrow({
      where: { weekId_position: { weekId: week.id, position: "RB" } },
    });
    await prisma.contestEntry.createMany({
      data: [
        {
          contestId: contest.id,
          rankableEntryId: canonical.id,
          weekTeam: "ATL",
          excluded: false,
        },
        {
          contestId: contest.id,
          rankableEntryId: artifact.id,
          weekTeam: "ATL",
          excluded: false,
        },
      ],
    });

    await syncWeeklyEligibleFieldFromSeason({
      weekId: week.id,
      position: "RB",
      scheduledTeamsOnly: false,
    });

    const contestAfter = await prisma.rankIQContest.findUniqueOrThrow({
      where: { weekId_position: { weekId: week.id, position: "RB" } },
      include: {
        entries: {
          where: { excluded: false },
          include: { rankableEntry: true },
        },
      },
    });
    const players = contestAfter.entries.map((entry) =>
      rankableEntryToRankingPlayer(entry.rankableEntry),
    );
    const metaById = new Map(
      contestAfter.entries.map((entry) => [
        entry.rankableEntryId,
        {
          provider: entry.rankableEntry.provider,
          externalId: entry.rankableEntry.externalId,
          position: entry.rankableEntry.position,
          type: entry.rankableEntry.type,
        },
      ]),
    );
    const deduped = dedupeRankingPlayersByIdentity(players, metaById);
    expect(deduped.filter((player) => player.name === "Brian Robinson")).toHaveLength(1);

    const validation = await validateWeeklyPoolCanonicalUniqueness(week.id);
    expect(validation.ok).toBe(true);
  });
});
