import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";
import {
  auditRosterTeamAccuracy,
  reconcileRosterTeamAccuracy,
} from "@/lib/nfl/roster-team-audit";
import { enrollSeasonPlayer } from "@/lib/season-players";

const suffix = `roster-team-${Date.now()}`;

function bundleFor(players: Array<{
  externalId: string;
  name: string;
  team: string;
  fantasyPosition: "QB" | "RB" | "WR" | "TE";
  sourceStatus?: string;
}>) {
  return {
    source: "test",
    syncedAt: new Date(),
    teamCount: 1,
    teams: [...new Set(players.map((row) => row.team))],
    players: players.map((row) => ({
      externalId: row.externalId,
      name: row.name,
      jerseyNumber: "1",
      sourcePosition: row.fantasyPosition,
      sourceStatus: row.sourceStatus ?? "ACT",
      height: "72",
      weight: "200",
      experience: "1",
      college: "Test",
      team: row.team,
      fantasyPosition: row.fantasyPosition,
      rosterUrl: "https://example.com",
    })),
    skippedNonFantasy: 0,
    fetchErrors: [],
  };
}

describe("roster team audit and reconciliation", () => {
  let seasonId = "";
  let weekId = "";

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2091,
        sport: `TEST-ROSTER-TEAM-${suffix}`,
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
      },
    });
    weekId = week.id;

    await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "WR",
        title: "WR",
        rankingDepth: 10,
        status: "OPEN",
      },
    });
  });

  afterAll(async () => {
    await prisma.season.delete({ where: { id: seasonId } });
  });

  it("updates canonical team from provider source without creating a duplicate", async () => {
    const canonical = await prisma.rankableEntry.create({
      data: {
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: `wr-trade-${suffix}`,
        type: "PLAYER",
        name: "Mover WR",
        shortName: "WR",
        team: "KC",
        position: "WR",
        opponent: "TBD",
        active: true,
      },
    });
    await enrollSeasonPlayer({
      seasonId,
      rankableEntryId: canonical.id,
      team: "KC",
      activeOnNFLRoster: true,
      sourceNflStatus: "ACT",
    });

    const report = await reconcileRosterTeamAccuracy({
      seasonId,
      bundle: bundleFor([
        {
          externalId: `wr-trade-${suffix}`,
          name: "Mover WR",
          team: "PHI",
          fantasyPosition: "WR",
        },
      ]),
      weekId,
      resyncWeek: false,
    });

    expect(report.corrected).toBe(1);
    const entries = await prisma.rankableEntry.findMany({
      where: { externalId: `wr-trade-${suffix}` },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.team).toBe("PHI");

    const seasonRow = await prisma.seasonPlayer.findUniqueOrThrow({
      where: {
        seasonId_rankableEntryId: {
          seasonId,
          rankableEntryId: canonical.id,
        },
      },
    });
    expect(seasonRow.team).toBe("PHI");
  });

  it("does not let legacy mock team override nflcom-bootstrap current team", async () => {
    const canonical = await prisma.rankableEntry.create({
      data: {
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: `wr-legacy-${suffix}`,
        type: "PLAYER",
        name: "Legacy Pollution WR",
        shortName: "WR",
        team: "NE",
        position: "WR",
        opponent: "TBD",
        active: true,
      },
    });
    await prisma.rankableEntry.create({
      data: {
        provider: "mock",
        externalId: `mock-wr-legacy-${suffix}`,
        type: "PLAYER",
        name: "Legacy Pollution WR",
        shortName: "WR",
        team: "NE",
        position: "WR",
        opponent: "TBD",
        active: false,
      },
    });
    await enrollSeasonPlayer({
      seasonId,
      rankableEntryId: canonical.id,
      team: "NE",
      activeOnNFLRoster: true,
      sourceNflStatus: "ACT",
    });

    const report = await reconcileRosterTeamAccuracy({
      seasonId,
      bundle: bundleFor([
        {
          externalId: `wr-legacy-${suffix}`,
          name: "Legacy Pollution WR",
          team: "PHI",
          fantasyPosition: "WR",
        },
      ]),
      resyncWeek: false,
    });

    expect(report.corrected).toBe(1);
    const row = await prisma.rankableEntry.findUniqueOrThrow({
      where: { id: canonical.id },
    });
    expect(row.team).toBe("PHI");
  });

  it("keeps historical weekTeam while updating current master team", async () => {
    const player = await prisma.rankableEntry.create({
      data: {
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: `wr-weekteam-${suffix}`,
        type: "PLAYER",
        name: "WeekTeam WR",
        shortName: "WR",
        team: "KC",
        position: "WR",
        opponent: "TBD",
        active: true,
      },
    });
    await enrollSeasonPlayer({
      seasonId,
      rankableEntryId: player.id,
      team: "KC",
      activeOnNFLRoster: true,
      sourceNflStatus: "ACT",
    });

    const contest = await prisma.rankIQContest.findUniqueOrThrow({
      where: { weekId_position: { weekId, position: "WR" } },
    });
    const entry = await prisma.contestEntry.create({
      data: {
        contestId: contest.id,
        rankableEntryId: player.id,
        weekTeam: "KC",
        excluded: false,
      },
    });

    await reconcileRosterTeamAccuracy({
      seasonId,
      bundle: bundleFor([
        {
          externalId: `wr-weekteam-${suffix}`,
          name: "WeekTeam WR",
          team: "PHI",
          fantasyPosition: "WR",
        },
      ]),
      weekId,
      resyncWeek: false,
    });

    const master = await prisma.rankableEntry.findUniqueOrThrow({
      where: { id: player.id },
    });
    expect(master.team).toBe("PHI");

    const historical = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: entry.id },
    });
    expect(historical.weekTeam).toBe("KC");
  });

  it("reflects current team in week pool after re-sync", async () => {
    const player = await prisma.rankableEntry.create({
      data: {
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: `wr-filter-${suffix}`,
        type: "PLAYER",
        name: "Filter WR",
        shortName: "WR",
        team: "DAL",
        position: "WR",
        opponent: "TBD",
        active: true,
      },
    });
    await enrollSeasonPlayer({
      seasonId,
      rankableEntryId: player.id,
      team: "DAL",
      activeOnNFLRoster: true,
      sourceNflStatus: "ACT",
    });

    const contest = await prisma.rankIQContest.findUniqueOrThrow({
      where: { weekId_position: { weekId, position: "WR" } },
    });
    await prisma.contestEntry.create({
      data: {
        contestId: contest.id,
        rankableEntryId: player.id,
        weekTeam: "DAL",
        excluded: false,
      },
    });

    await reconcileRosterTeamAccuracy({
      seasonId,
      bundle: bundleFor([
        {
          externalId: `wr-filter-${suffix}`,
          name: "Filter WR",
          team: "PHI",
          fantasyPosition: "WR",
        },
      ]),
      weekId,
      resyncWeek: true,
    });

    const poolEntry = await prisma.contestEntry.findFirstOrThrow({
      where: { contestId: contest.id, rankableEntryId: player.id },
    });
    expect(poolEntry.weekTeam).toBe("PHI");

    const audit = await auditRosterTeamAccuracy({
      seasonId,
      bundle: bundleFor([
        {
          externalId: `wr-filter-${suffix}`,
          name: "Filter WR",
          team: "PHI",
          fantasyPosition: "WR",
        },
      ]),
      weekId,
    });
    expect(audit.mismatches).toHaveLength(0);
  });

  it("flags active provider IDs on multiple teams", async () => {
    const sharedExternalId = `shared-id-${suffix}`;
    const a = await prisma.rankableEntry.create({
      data: {
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: sharedExternalId,
        type: "PLAYER",
        name: "Shared WR A",
        shortName: "A",
        team: "DAL",
        position: "WR",
        opponent: "TBD",
        active: true,
      },
    });
    const b = await prisma.rankableEntry.create({
      data: {
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: `${sharedExternalId}-dup`,
        type: "PLAYER",
        name: "Shared WR B",
        shortName: "B",
        team: "PHI",
        position: "WR",
        opponent: "TBD",
        active: true,
      },
    });
    await enrollSeasonPlayer({
      seasonId,
      rankableEntryId: a.id,
      team: "DAL",
      activeOnNFLRoster: true,
    });
    await enrollSeasonPlayer({
      seasonId,
      rankableEntryId: b.id,
      team: "PHI",
      activeOnNFLRoster: true,
    });

    const audit = await auditRosterTeamAccuracy({
      seasonId,
      bundle: bundleFor([
        {
          externalId: sharedExternalId,
          name: "Shared WR A",
          team: "DAL",
          fantasyPosition: "WR",
        },
      ]),
    });

    expect(audit.duplicateProviderTeams).toHaveLength(0);
    expect(audit.mismatches.some((row) => row.externalId === sharedExternalId)).toBe(
      false,
    );
  });

  it("keeps rankable and season team synchronized after reconciliation", async () => {
    const player = await prisma.rankableEntry.create({
      data: {
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: `rb-sync-${suffix}`,
        type: "PLAYER",
        name: "Sync RB",
        shortName: "RB",
        team: "MIN",
        position: "RB",
        opponent: "TBD",
        active: true,
      },
    });
    await enrollSeasonPlayer({
      seasonId,
      rankableEntryId: player.id,
      team: "MIN",
      activeOnNFLRoster: true,
      sourceNflStatus: "ACT",
    });

    await prisma.rankableEntry.update({
      where: { id: player.id },
      data: { team: "GB" },
    });

    await reconcileRosterTeamAccuracy({
      seasonId,
      bundle: bundleFor([
        {
          externalId: `rb-sync-${suffix}`,
          name: "Sync RB",
          team: "MIN",
          fantasyPosition: "RB",
        },
      ]),
      resyncWeek: false,
    });

    const row = await prisma.seasonPlayer.findUniqueOrThrow({
      where: {
        seasonId_rankableEntryId: { seasonId, rankableEntryId: player.id },
      },
      include: { rankableEntry: true },
    });
    expect(row.team).toBe("MIN");
    expect(row.rankableEntry.team).toBe("MIN");
  });
});
