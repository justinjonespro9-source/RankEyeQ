import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { auditContestPool } from "@/lib/nfl/manual/pool-audit";
import {
  normalizeTeamAbbr,
  teamCodesMatch,
} from "@/lib/nfl/manual/parse-common";
import { syncWeeklyEligibleFieldFromSeason } from "@/lib/nfl/weekly-eligibility";
import {
  findGameForTeam,
  formatOpponentLabel,
} from "@/lib/providers/nfl/eligibility";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";
import { enrollSeasonPlayer } from "@/lib/season-players";
import { validateWeeklyPoolCanonicalUniqueness } from "@/lib/nfl/pool-canonical-uniqueness";

const suffix = `opp-stamp-${Date.now()}`;

describe("team code normalization", () => {
  it("maps legacy aliases to canonical abbreviations", () => {
    expect(normalizeTeamAbbr("jac")).toBe("JAX");
    expect(normalizeTeamAbbr("WSH")).toBe("WAS");
    expect(normalizeTeamAbbr("OAK")).toBe("LV");
    expect(normalizeTeamAbbr("LA")).toBe("LAR");
    expect(normalizeTeamAbbr("GNB")).toBe("GB");
    expect(teamCodesMatch("JAC", "JAX")).toBe(true);
    expect(teamCodesMatch("WSH", "WAS")).toBe(true);
    expect(teamCodesMatch("LV", "WAS")).toBe(false);
  });

  it("formats opponent labels across alias mismatches", () => {
    expect(formatOpponentLabel("JAC", "MIN", "JAX")).toBe("@ MIN");
    expect(formatOpponentLabel("WSH", "WAS", "LV")).toBe("vs LV");
    expect(formatOpponentLabel("LV", "WAS", "LV")).toBe("@ WAS");
  });

  it("finds games when schedule and roster use alias variants", () => {
    const games = [
      { id: "1", homeTeam: "JAX", awayTeam: "MIN" },
      { id: "2", homeTeam: "WAS", awayTeam: "LV" },
    ];
    expect(findGameForTeam(games, "JAC")?.id).toBe("1");
    expect(findGameForTeam(games, "WSH")?.id).toBe("2");
    expect(findGameForTeam(games, "OAK")?.id).toBe("2");
  });
});

describe("weekly eligibility matchup stamping", () => {
  let seasonId = "";
  let weekId = "";

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2091,
        sport: `TEST-OPP-${suffix}`,
        active: false,
      },
    });
    seasonId = season.id;
    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: `Week 1 ${suffix}`,
        startsAt: new Date("2091-09-07T00:00:00Z"),
        endsAt: new Date("2091-09-14T00:00:00Z"),
        status: "OPEN",
        isTest: false,
      },
    });
    weekId = week.id;

    await prisma.nflGame.createMany({
      data: [
        {
          provider: "manual",
          externalId: `lv-was-${suffix}`,
          seasonId,
          weekId,
          seasonYear: 2091,
          weekNumber: 1,
          homeTeam: "WAS",
          awayTeam: "LV",
          startsAt: new Date("2091-09-07T17:00:00Z"),
        },
        {
          provider: "manual",
          externalId: `car-nyj-${suffix}`,
          seasonId,
          weekId,
          seasonYear: 2091,
          weekNumber: 1,
          homeTeam: "NYJ",
          awayTeam: "CAR",
          startsAt: new Date("2091-09-07T17:00:00Z"),
        },
        {
          provider: "manual",
          externalId: `den-sea-${suffix}`,
          seasonId,
          weekId,
          seasonYear: 2091,
          weekNumber: 1,
          homeTeam: "SEA",
          awayTeam: "DEN",
          startsAt: new Date("2091-09-07T20:05:00Z"),
        },
        {
          provider: "manual",
          // Schedule uses canonical JAX; roster will use legacy JAC.
          externalId: `min-jax-${suffix}`,
          seasonId,
          weekId,
          seasonYear: 2091,
          weekNumber: 1,
          homeTeam: "JAX",
          awayTeam: "MIN",
          startsAt: new Date("2091-09-07T13:00:00Z"),
        },
      ],
    });

    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      await prisma.rankIQContest.create({
        data: {
          seasonId,
          weekId,
          position,
          title: position,
          rankingDepth: 10,
          status: "DRAFT",
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.season.delete({ where: { id: seasonId } });
  });

  it("stamps opponent + kickoff for O'Connell/Dillon/Mitchell/Barner-style rows", async () => {
    const players = [
      { name: "Aidan O'Connell", team: "LV", position: "QB" as const, ext: "aidan-o-connell" },
      { name: "AJ Dillon", team: "CAR", position: "RB" as const, ext: "a-j-dillon" },
      { name: "Adonai Mitchell", team: "NYJ", position: "WR" as const, ext: "adonai-mitchell" },
      { name: "AJ Barner", team: "SEA", position: "TE" as const, ext: "aj-barner" },
    ];

    for (const player of players) {
      const entry = await prisma.rankableEntry.create({
        data: {
          provider: NFL_COM_BOOTSTRAP_PROVIDER,
          externalId: `${player.ext}-${suffix}`,
          type: "PLAYER",
          name: player.name,
          shortName: player.name.split(" ").slice(-1)[0]!,
          team: player.team,
          position: player.position,
          opponent: "TBD",
          active: true,
        },
      });
      await enrollSeasonPlayer({
        seasonId,
        rankableEntryId: entry.id,
        team: player.team,
        activeOnNFLRoster: true,
      });
    }

    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      const result = await syncWeeklyEligibleFieldFromSeason({
        weekId,
        position,
        scheduledTeamsOnly: true,
      });
      expect(result.skippedImmutable).toBe(false);
      expect(result.matchupsStamped).toBeGreaterThan(0);
    }

    const expected = {
      "Aidan O'Connell": { opponent: "@ WAS", team: "LV" },
      "AJ Dillon": { opponent: "@ NYJ", team: "CAR" },
      "Adonai Mitchell": { opponent: "vs CAR", team: "NYJ" },
      "AJ Barner": { opponent: "vs DEN", team: "SEA" },
    } as const;

    for (const [name, expectRow] of Object.entries(expected)) {
      const entry = await prisma.rankableEntry.findFirstOrThrow({
        where: {
          name,
          provider: NFL_COM_BOOTSTRAP_PROVIDER,
          externalId: { endsWith: suffix },
        },
        include: {
          contestEntries: {
            where: { contest: { weekId }, excluded: false },
            include: { game: true },
          },
        },
      });
      expect(entry.team).toBe(expectRow.team);
      expect(entry.opponent).toBe(expectRow.opponent);
      expect(entry.gameStartsAt).toBeInstanceOf(Date);
      expect(entry.contestEntries[0]?.gameId).toBeTruthy();
      expect(entry.contestEntries[0]?.game?.startsAt).toBeInstanceOf(Date);
    }

    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      const audit = await auditContestPool(weekId, position);
      expect(audit.blockers, audit.blockers.join(" | ")).toEqual([]);
      expect(audit.ready).toBe(true);
    }

    const validation = await validateWeeklyPoolCanonicalUniqueness(weekId);
    expect(validation.ok).toBe(true);
  });

  it("matches JAC roster team to JAX schedule game and stamps matchup", async () => {
    const entry = await prisma.rankableEntry.create({
      data: {
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: `alias-qb-${suffix}`,
        type: "PLAYER",
        name: "Alias Jaguar QB",
        shortName: "Jaguar",
        team: "JAC",
        position: "QB",
        opponent: "TBD",
        active: true,
      },
    });
    await enrollSeasonPlayer({
      seasonId,
      rankableEntryId: entry.id,
      team: "JAC",
      activeOnNFLRoster: true,
    });

    await syncWeeklyEligibleFieldFromSeason({
      weekId,
      position: "QB",
      scheduledTeamsOnly: true,
    });

    const updated = await prisma.rankableEntry.findUniqueOrThrow({
      where: { id: entry.id },
      include: {
        contestEntries: {
          where: { contest: { weekId }, excluded: false },
          include: { game: true },
        },
      },
    });
    expect(updated.opponent).toBe("vs MIN");
    expect(updated.gameStartsAt).toBeInstanceOf(Date);
    expect(updated.contestEntries[0]?.game?.homeTeam).toBe("JAX");
  });

  it("does not mutate LOCKED weeks", async () => {
    await prisma.week.update({
      where: { id: weekId },
      data: { status: "LOCKED" },
    });
    const before = await prisma.rankableEntry.findFirstOrThrow({
      where: {
        name: "Aidan O'Connell",
        externalId: { endsWith: suffix },
      },
    });
    const result = await syncWeeklyEligibleFieldFromSeason({
      weekId,
      position: "QB",
      scheduledTeamsOnly: true,
    });
    expect(result.skippedImmutable).toBe(true);
    const after = await prisma.rankableEntry.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(after.opponent).toBe(before.opponent);
    await prisma.week.update({
      where: { id: weekId },
      data: { status: "OPEN" },
    });
  });
});
