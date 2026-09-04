import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { isSeasonPlayerEligibleForWeeklyField } from "@/lib/nfl/eligibility-rules";
import { mapNflComStatusToSeasonFields } from "@/lib/nfl/roster-status";
import { syncWeeklyEligibleFieldFromSeason } from "@/lib/nfl/weekly-eligibility";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";
import { enrollSeasonPlayer } from "@/lib/season-players";

const suffix = `dev-status-${Date.now()}`;

describe("DEV practice-squad status blocks weekly eligibility", () => {
  let seasonId = "";
  let weekId = "";
  let actId = "";
  let devId = "";

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2092,
        sport: `TEST-DEV-${suffix}`,
        active: false,
      },
    });
    seasonId = season.id;
    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: `Week 1 ${suffix}`,
        startsAt: new Date("2092-09-07T00:00:00Z"),
        endsAt: new Date("2092-09-14T00:00:00Z"),
        status: "OPEN",
        isTest: false,
      },
    });
    weekId = week.id;
    await prisma.nflGame.create({
      data: {
        provider: "manual",
        externalId: `game-${suffix}`,
        seasonId,
        weekId,
        seasonYear: 2092,
        weekNumber: 1,
        homeTeam: "MIN",
        awayTeam: "GB",
        startsAt: new Date("2092-09-07T17:00:00Z"),
      },
    });
    await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "QB",
        title: "QB",
        rankingDepth: 10,
        status: "DRAFT",
      },
    });

    const actMapped = mapNflComStatusToSeasonFields("ACT");
    const act = await prisma.rankableEntry.create({
      data: {
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: `act-qb-${suffix}`,
        type: "PLAYER",
        name: "Active Starter",
        shortName: "Starter",
        team: "MIN",
        position: "QB",
        opponent: "TBD",
        active: true,
      },
    });
    actId = act.id;
    await enrollSeasonPlayer({
      seasonId,
      rankableEntryId: act.id,
      team: "MIN",
      nflStatus: actMapped.nflStatus,
      activeOnNFLRoster: actMapped.activeOnNFLRoster,
      sourcePosition: "QB",
      sourceNflStatus: "ACT",
    });

    const devMapped = mapNflComStatusToSeasonFields("DEV");
    const dev = await prisma.rankableEntry.create({
      data: {
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: `dev-qb-${suffix}`,
        type: "PLAYER",
        name: "Practice Squad QB",
        shortName: "Practice",
        team: "MIN",
        position: "QB",
        opponent: "TBD",
        active: true,
      },
    });
    devId = dev.id;
    await enrollSeasonPlayer({
      seasonId,
      rankableEntryId: dev.id,
      team: "MIN",
      nflStatus: devMapped.nflStatus,
      activeOnNFLRoster: devMapped.activeOnNFLRoster,
      sourcePosition: "QB",
      sourceNflStatus: "DEV",
    });

    // Pre-seed a stale active ContestEntry for the DEV player (simulates prod inflation).
    await prisma.contestEntry.create({
      data: {
        contestId: (
          await prisma.rankIQContest.findUniqueOrThrow({
            where: { weekId_position: { weekId, position: "QB" } },
          })
        ).id,
        rankableEntryId: dev.id,
        weekTeam: "MIN",
        excluded: false,
      },
    });
  });

  afterAll(async () => {
    await prisma.season.delete({ where: { id: seasonId } });
  });

  it("maps DEV to PRACTICE_SQUAD with activeOnNFLRoster=false and preserves sourceNflStatus", async () => {
    const mapped = mapNflComStatusToSeasonFields("DEV");
    expect(mapped).toEqual({
      nflStatus: "PRACTICE_SQUAD",
      activeOnNFLRoster: false,
    });
    expect(isSeasonPlayerEligibleForWeeklyField(mapped)).toBe(false);

    const sp = await prisma.seasonPlayer.findUniqueOrThrow({
      where: {
        seasonId_rankableEntryId: {
          seasonId,
          rankableEntryId: devId,
        },
      },
    });
    expect(sp.sourceNflStatus).toBe("DEV");
    expect(sp.nflStatus).toBe("PRACTICE_SQUAD");
    expect(sp.activeOnNFLRoster).toBe(false);
  });

  it("prunes DEV players from the weekly pool on sync", async () => {
    const result = await syncWeeklyEligibleFieldFromSeason({
      weekId,
      position: "QB",
      scheduledTeamsOnly: true,
    });
    expect(result.skippedImmutable).toBe(false);
    expect(result.skippedIneligible).toBeGreaterThanOrEqual(1);
    expect(result.pruned).toBeGreaterThanOrEqual(1);

    const active = await prisma.contestEntry.findMany({
      where: { contest: { weekId }, excluded: false },
      select: { rankableEntryId: true },
    });
    const ids = active.map((row) => row.rankableEntryId);
    expect(ids).toContain(actId);
    expect(ids).not.toContain(devId);

    const pruned = await prisma.contestEntry.findFirstOrThrow({
      where: { rankableEntryId: devId, contest: { weekId } },
    });
    expect(pruned.excluded).toBe(true);
  });
});
