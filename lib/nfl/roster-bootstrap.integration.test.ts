import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { bootstrapSeasonRosterFromNflCom } from "@/lib/nfl/roster-bootstrap";
import {
  bundleFromFixtureHtml,
  NFL_COM_BOOTSTRAP_PROVIDER,
} from "@/lib/providers/nfl/nflcom/fetch-rosters";
import { rosterUrlForTeamSlug } from "@/lib/providers/nfl/nflcom/teams";

const suffix = `rb${Date.now()}`;
const FIXTURE = join(
  import.meta.dirname,
  "../providers/nfl/nflcom/fixtures/minnesota-vikings-roster.html",
);

function minnesotaBundle() {
  return bundleFromFixtureHtml({
    team: "MIN",
    slug: "minnesota-vikings",
    html: readFileSync(FIXTURE, "utf8"),
  });
}

describe("NFL roster bootstrap", () => {
  let seasonId = "";
  let weekId = "";

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2097,
        sport: `TEST-ROSTER-${suffix}`,
        active: false,
      },
    });
    seasonId = season.id;

    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: "Week 1",
        startsAt: new Date("2097-09-07T00:00:00Z"),
        endsAt: new Date("2097-09-14T00:00:00Z"),
        status: "OPEN",
      },
    });
    weekId = week.id;

    await prisma.nflGame.create({
      data: {
        provider: "test",
        externalId: `game-${suffix}`,
        seasonId,
        weekId,
        seasonYear: 2097,
        weekNumber: 1,
        homeTeam: "NYG",
        awayTeam: "MIN",
        startsAt: new Date("2097-09-07T17:00:00Z"),
      },
    });

    for (const pos of ["QB", "RB", "WR", "TE", "DEF"] as const) {
      await prisma.rankIQContest.create({
        data: {
          seasonId,
          weekId,
          position: pos,
          title: `Week 1 ${pos}`,
          rankingDepth: 10,
          status: "DRAFT",
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.season.deleteMany({ where: { id: seasonId } });
  });

  it("imports Minnesota fantasy players and is idempotent", async () => {
    const bundle = minnesotaBundle();
    const first = await bootstrapSeasonRosterFromNflCom({
      seasonId,
      bundle,
      runWeeklySync: true,
    });

    expect(first.teams.imported).toBe(1);
    expect(first.counts.QB).toBeGreaterThan(0);
    expect(first.newlyCreated + first.matchedExisting).toBeGreaterThan(0);
    expect(first.minnesota?.activeQb).toEqual(
      expect.arrayContaining(["Kyler Murray", "J.J. McCarthy", "Carson Wentz"]),
    );
    expect(first.minnesota?.activeRb).toEqual(
      expect.arrayContaining([
        "Aaron Jones",
        "Jordan Mason",
        "Demond Claiborne",
        "Max Bredeson",
      ]),
    );
    expect(first.minnesota?.activeWr).toEqual(
      expect.arrayContaining(["Justin Jefferson", "Jordan Addison"]),
    );

    const playerCount = await prisma.rankableEntry.count({
      where: { provider: NFL_COM_BOOTSTRAP_PROVIDER },
    });

    const second = await bootstrapSeasonRosterFromNflCom({
      seasonId,
      bundle,
      runWeeklySync: false,
    });

    expect(second.newlyCreated).toBe(0);
    expect(second.skipped + second.unchanged + second.updated).toBeGreaterThan(0);

    const playerCountAfter = await prisma.rankableEntry.count({
      where: { provider: NFL_COM_BOOTSTRAP_PROVIDER },
    });
    expect(playerCountAfter).toBe(playerCount);

    const cutPlayer = await prisma.seasonPlayer.findFirst({
      where: {
        seasonId,
        displayName: "Max Brosmer",
        position: "QB",
      },
    });
    expect(cutPlayer?.activeOnNFLRoster).toBe(false);
    expect(cutPlayer?.sourceNflStatus).toBe("CUT");

    const practicePlayer = await prisma.seasonPlayer.findFirst({
      where: {
        seasonId,
        displayName: "Jermar Jefferson",
        position: "RB",
      },
    });
    expect(practicePlayer?.activeOnNFLRoster).toBe(false);

    const defenseTeams = await prisma.seasonPlayer.findMany({
      where: { seasonId, position: "DEF" },
      select: { team: true },
    });
    expect(new Set(defenseTeams.map((row) => row.team)).size).toBe(32);
  });

  it("matches suffix punctuation variants without duplicating", async () => {
    const season = await prisma.season.create({
      data: {
        year: 2096,
        sport: `TEST-ROSTER-SUFFIX-${suffix}`,
        active: false,
      },
    });

    await prisma.rankableEntry.create({
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

    const report = await bootstrapSeasonRosterFromNflCom({
      seasonId: season.id,
      bundle: minnesotaBundle(),
      runWeeklySync: false,
    });

    expect(report.ambiguous.length).toBe(0);

    const seasonPlayers = await prisma.seasonPlayer.findMany({
      where: {
        seasonId: season.id,
        displayName: { contains: "Aaron Jones", mode: "insensitive" },
      },
      include: { rankableEntry: true },
    });
    expect(seasonPlayers).toHaveLength(1);
    expect(seasonPlayers[0]?.rankableEntry.externalId).toBe("aaron-jones");
    expect(seasonPlayers[0]?.rankableEntry.provider).toBe(NFL_COM_BOOTSTRAP_PROVIDER);

    await prisma.season.delete({ where: { id: season.id } });
  });
});

describe("bundleFromFixtureHtml", () => {
  it("uses roster URL from team slug", () => {
    const bundle = minnesotaBundle();
    expect(bundle.players[0]?.rosterUrl).toBe(
      rosterUrlForTeamSlug("minnesota-vikings"),
    );
  });
});
