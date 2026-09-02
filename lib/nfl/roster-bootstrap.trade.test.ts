import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { mergeRankableEntryIntoCanonical } from "@/lib/nfl/player-consolidation";
import { bootstrapSeasonRosterFromNflCom } from "@/lib/nfl/roster-bootstrap";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";

const suffix = `trade${Date.now()}`;

describe("roster bootstrap trade/idempotency", () => {
  let seasonId = "";

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2095,
        sport: `TEST-TRADE-${suffix}`,
        active: false,
      },
    });
    seasonId = season.id;
  });

  afterAll(async () => {
    await prisma.season.deleteMany({ where: { id: seasonId } });
  });

  it("updates team on same provider ID instead of creating a new identity", async () => {
    const player = {
      externalId: "test-player-trade",
      name: "Trade Test Player",
      jerseyNumber: "1",
      sourcePosition: "WR",
      sourceStatus: "ACT",
      height: "72",
      weight: "200",
      experience: "3",
      college: "Test U",
      team: "KC",
      fantasyPosition: "WR" as const,
      rosterUrl: "https://example.com",
    };

    const bundleA = {
      source: "test",
      syncedAt: new Date(),
      teamCount: 1,
      teams: ["KC"],
      players: [player],
      skippedNonFantasy: 0,
      fetchErrors: [],
    };

    const first = await bootstrapSeasonRosterFromNflCom({
      seasonId,
      bundle: bundleA,
      runWeeklySync: false,
    });
    expect(first.newlyCreated + first.matchedExisting).toBeGreaterThan(0);

    const bundleB = {
      ...bundleA,
      teams: ["PHI"],
      players: [{ ...player, team: "PHI" }],
    };

    const second = await bootstrapSeasonRosterFromNflCom({
      seasonId,
      bundle: bundleB,
      runWeeklySync: false,
    });
    expect(second.newlyCreated).toBe(0);

    const entries = await prisma.rankableEntry.findMany({
      where: {
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: "test-player-trade",
      },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.team).toBe("PHI");

    const seasonPlayers = await prisma.seasonPlayer.findMany({
      where: { seasonId, rankableEntryId: entries[0]!.id },
    });
    expect(seasonPlayers).toHaveLength(1);
    expect(seasonPlayers[0]?.team).toBe("PHI");

    const third = await bootstrapSeasonRosterFromNflCom({
      seasonId,
      bundle: bundleB,
      runWeeklySync: false,
    });
    expect(third.newlyCreated).toBe(0);
    expect(third.skipped + third.unchanged + third.updated).toBeGreaterThan(0);
  });

  it("preserves historical weekTeam when consolidating duplicate identities", async () => {
    const season = await prisma.season.create({
      data: {
        year: 2094,
        sport: `TEST-MERGE-${suffix}`,
        active: false,
      },
    });
    const week1 = await prisma.week.create({
      data: {
        seasonId: season.id,
        weekNumber: 1,
        label: "Week 1",
        startsAt: new Date("2094-09-07T00:00:00Z"),
        endsAt: new Date("2094-09-14T00:00:00Z"),
        status: "OPEN",
      },
    });
    const week6 = await prisma.week.create({
      data: {
        seasonId: season.id,
        weekNumber: 6,
        label: "Week 6",
        startsAt: new Date("2094-10-12T00:00:00Z"),
        endsAt: new Date("2094-10-19T00:00:00Z"),
        status: "OPEN",
      },
    });

    const contest1 = await prisma.rankIQContest.create({
      data: {
        seasonId: season.id,
        weekId: week1.id,
        position: "WR",
        title: "Week 1 WR",
        rankingDepth: 10,
        status: "OPEN",
      },
    });
    const contest6 = await prisma.rankIQContest.create({
      data: {
        seasonId: season.id,
        weekId: week6.id,
        position: "WR",
        title: "Week 6 WR",
        rankingDepth: 10,
        status: "OPEN",
      },
    });

    const legacy = await prisma.rankableEntry.create({
      data: {
        provider: "mock",
        externalId: `mock-trade-${suffix}`,
        type: "PLAYER",
        name: "Mover Player",
        shortName: "Player",
        team: "KC",
        position: "WR",
        opponent: "TBD",
        active: true,
      },
    });
    const canonical = await prisma.rankableEntry.create({
      data: {
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: `mover-player-${suffix}`,
        type: "PLAYER",
        name: "Mover Player",
        shortName: "Player",
        team: "PHI",
        position: "WR",
        opponent: "TBD",
        active: true,
      },
    });

    await prisma.contestEntry.create({
      data: {
        contestId: contest1.id,
        rankableEntryId: legacy.id,
        weekTeam: "KC",
        excluded: false,
      },
    });
    await prisma.contestEntry.create({
      data: {
        contestId: contest6.id,
        rankableEntryId: canonical.id,
        weekTeam: "PHI",
        excluded: false,
      },
    });

    await mergeRankableEntryIntoCanonical({
      canonicalId: canonical.id,
      duplicateId: legacy.id,
      reason: "test merge",
    });

    const week1Entry = await prisma.contestEntry.findFirst({
      where: { contestId: contest1.id, rankableEntryId: canonical.id },
    });
    expect(week1Entry?.weekTeam).toBe("KC");

    const week6Entry = await prisma.contestEntry.findFirst({
      where: { contestId: contest6.id, rankableEntryId: canonical.id },
    });
    expect(week6Entry?.weekTeam).toBe("PHI");

    await prisma.season.delete({ where: { id: season.id } });
  });
});
