import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  findDuplicateExternalIds,
  commitWeeklyImport,
} from "@/lib/nfl/import";
import {
  addManualContestEntry,
  buildRankIqPositionPools,
  setContestEntryExcluded,
} from "@/lib/nfl/pool-builder";
import {
  formatOpponentLabel,
  isThursdayThroughMonday,
} from "@/lib/providers/nfl/eligibility";
import { MockNflProvider } from "@/lib/providers/nfl/mock/provider";
import {
  buildWeeklyEligibleBundle,
  mapSportsDataGames,
  mapSportsDataPlayers,
  mapSportsDataTeams,
} from "@/lib/providers/nfl/sportsdataio/map";

describe("provider mapping", () => {
  it("maps SportsDataIO teams/players/games into normalized DTOs", () => {
    const teams = mapSportsDataTeams([
      { TeamID: 1, Key: "KC", FullName: "Kansas City Chiefs", City: "Kansas City" },
      { TeamID: 2, Key: "BUF", FullName: "Buffalo Bills" },
    ]);
    expect(teams).toHaveLength(2);
    expect(teams[0].abbreviation).toBe("KC");

    const players = mapSportsDataPlayers([
      {
        PlayerID: 100,
        Name: "Patrick Mahomes",
        Team: "KC",
        FantasyPosition: "QB",
        PhotoUrl: "https://example.com/mahomes.png",
        Active: true,
        Status: "Active",
      },
      {
        PlayerID: 101,
        Name: "Practice Squad Guy",
        Team: "KC",
        FantasyPosition: "WR",
        Active: true,
        Status: "Practice Squad",
      },
      {
        PlayerID: 102,
        Name: "Not Fantasy",
        Team: "KC",
        FantasyPosition: "OL",
        Active: true,
      },
    ]);
    expect(players).toHaveLength(2);
    expect(players[0].externalId).toBe("100");
    expect(players[0].headshotUrl).toContain("mahomes");
    expect(players[1].active).toBe(false);

    const games = mapSportsDataGames(
      [
        {
          GameKey: "202610101",
          Season: 2026,
          Week: 1,
          HomeTeam: "BUF",
          AwayTeam: "KC",
          DateTime: "2026-09-06T17:00:00",
          Status: "Scheduled",
        },
      ],
      2026,
      1,
    );
    expect(games).toHaveLength(1);
    expect(games[0].homeTeam).toBe("BUF");
  });

  it("builds weekly eligibility and DEF mapping", () => {
    const bundle = buildWeeklyEligibleBundle({
      seasonYear: 2026,
      weekNumber: 1,
      games: [
        {
          externalId: "g1",
          seasonYear: 2026,
          weekNumber: 1,
          homeTeam: "BUF",
          awayTeam: "KC",
          startsAt: new Date("2026-09-06T17:00:00Z"), // Sunday
          status: "SCHEDULED",
        },
      ],
      players: [
        {
          externalId: "p1",
          name: "Josh Allen",
          shortName: "Allen",
          team: "BUF",
          position: "QB",
          headshotUrl: null,
          active: true,
        },
        {
          externalId: "p2",
          name: "Bye Player",
          shortName: "Bye",
          team: "DAL",
          position: "RB",
          headshotUrl: null,
          active: true,
        },
      ],
      defenses: [
        {
          externalId: "def-BUF",
          team: "BUF",
          name: "Buffalo Bills D/ST",
          shortName: "BUF DEF",
          headshotUrl: null,
          active: true,
        },
        {
          externalId: "def-DAL",
          team: "DAL",
          name: "Dallas Cowboys D/ST",
          shortName: "DAL DEF",
          headshotUrl: null,
          active: true,
        },
      ],
    });

    expect(bundle.players.map((p) => p.externalId)).toEqual(["p1"]);
    expect(bundle.defenses.map((d) => d.externalId)).toEqual(["def-BUF"]);
    expect(bundle.defenses[0].opponent).toBe("vs KC");
    expect(bundle.invalid.some((row) => row.reason === "bye_or_missing_game")).toBe(
      true,
    );
  });

  it("detects Thursday-through-Monday eligibility", () => {
    // 2026-09-03 Thu, 2026-09-07 Mon (ET afternoon)
    expect(isThursdayThroughMonday(new Date("2026-09-03T20:00:00Z"))).toBe(true);
    expect(isThursdayThroughMonday(new Date("2026-09-07T20:00:00Z"))).toBe(true);
    expect(isThursdayThroughMonday(new Date("2026-09-09T20:00:00Z"))).toBe(false); // Wed
    expect(formatOpponentLabel("KC", "BUF", "KC")).toBe("@ BUF");
    expect(formatOpponentLabel("BUF", "BUF", "KC")).toBe("vs KC");
  });

  it("flags duplicate external IDs", () => {
    expect(findDuplicateExternalIds(["a", "b", "a", "c", "b"])).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("idempotent import + pool generation", () => {
  const suffix = `nfl${Date.now()}`;
  let seasonId = "";
  let weekId = "";
  const provider = new MockNflProvider(`mock-${suffix}`);

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2098,
        sport: `NFL-${suffix}`,
        active: false,
      },
    });
    seasonId = season.id;

    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: "Import Week 1",
        startsAt: new Date("2026-09-03T00:00:00Z"),
        endsAt: new Date("2026-09-09T00:00:00Z"),
        status: "UPCOMING",
      },
    });
    weekId = week.id;
  });

  afterAll(async () => {
    await prisma.contestEntry.deleteMany({
      where: { contest: { weekId } },
    });
    await prisma.rankIQContest.deleteMany({ where: { weekId } });
    await prisma.rankableEntry.updateMany({
      where: { provider: provider.name },
      data: { gameId: null },
    });
    await prisma.nflGame.deleteMany({ where: { weekId } });
    await prisma.rankableEntry.deleteMany({ where: { provider: provider.name } });
    await prisma.week.deleteMany({ where: { id: weekId } });
    await prisma.season.deleteMany({ where: { id: seasonId } });
  });

  it("imports games/players/defenses idempotently", async () => {
    const first = await commitWeeklyImport({
      seasonId,
      weekId,
      seasonYear: 2026,
      weekNumber: 1,
      provider,
    });
    expect(first.gamesCreated).toBeGreaterThan(0);
    expect(first.playersCreated).toBeGreaterThan(0);
    expect(first.defensesCreated).toBe(32);

    const second = await commitWeeklyImport({
      seasonId,
      weekId,
      seasonYear: 2026,
      weekNumber: 1,
      provider,
    });
    expect(second.gamesCreated).toBe(0);
    expect(second.playersCreated).toBe(0);
    expect(second.defensesCreated).toBe(0);
    expect(second.gamesUnchanged + second.gamesUpdated).toBe(first.gamesCreated);
    expect(
      second.playersUnchanged + second.playersUpdated,
    ).toBe(first.playersCreated);
    expect(
      second.defensesUnchanged + second.defensesUpdated,
    ).toBe(32);

    const games = await prisma.nflGame.count({ where: { weekId } });
    expect(games).toBe(first.gamesCreated);
  });

  it("builds position pools and preserves manual exclusions", async () => {
    await commitWeeklyImport({
      seasonId,
      weekId,
      seasonYear: 2026,
      weekNumber: 1,
      provider,
    });

    const first = await buildRankIqPositionPools({ weekId, provider });
    expect(first.contestsEnsured).toBe(5);
    expect(first.entriesCreated).toBeGreaterThan(0);
    expect(first.byPosition.DEF.inPool).toBeGreaterThan(0);

    const qbContest = await prisma.rankIQContest.findUniqueOrThrow({
      where: { weekId_position: { weekId, position: "QB" } },
      include: { entries: true },
    });
    const target = qbContest.entries[0];
    expect(target).toBeTruthy();

    await setContestEntryExcluded({
      contestEntryId: target.id,
      excluded: true,
    });

    const second = await buildRankIqPositionPools({ weekId, provider });
    expect(second.entriesSkippedExcluded).toBeGreaterThan(0);

    const stillExcluded = await prisma.contestEntry.findUnique({
      where: { id: target.id },
    });
    expect(stillExcluded?.excluded).toBe(true);

    await setContestEntryExcluded({
      contestEntryId: target.id,
      excluded: false,
    });
    await addManualContestEntry({
      contestId: qbContest.id,
      rankableEntryId: target.rankableEntryId,
    });
    const manual = await prisma.contestEntry.findUnique({
      where: { id: target.id },
    });
    expect(manual?.manuallyAdded).toBe(true);
    expect(manual?.excluded).toBe(false);
  });
});
