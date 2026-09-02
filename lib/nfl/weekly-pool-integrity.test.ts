import { describe, expect, it } from "vitest";
import {
  canonicalDefenseExternalId,
  defenseEntryIdentityKey,
  defenseFranchiseKey,
  isCanonicalDefenseRankableEntry,
} from "@/lib/nfl/defense-identity";
import {
  isLegacyTestPoolProvider,
  isProductionWeeklyPoolIdentity,
} from "@/lib/nfl/pool-source";
import {
  isMutableContestStatus,
  isMutableWeekStatus,
} from "@/lib/nfl/weekly-pool-mutable";
import { validateDefenseFranchiseUniqueness } from "@/lib/nfl/pool-canonical-uniqueness";
import { prisma } from "@/lib/db";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";
import { syncWeeklyEligibleFieldFromSeason } from "@/lib/nfl/weekly-eligibility";
import { isMutableWeeklyPool } from "@/lib/nfl/weekly-pool-mutable";

describe("defense franchise identity", () => {
  it("uses team abbreviation as franchise key", () => {
    expect(defenseFranchiseKey(" ne ")).toBe("NE");
    expect(defenseEntryIdentityKey({
      team: "JAX",
      position: "DEF",
      provider: NFL_COM_BOOTSTRAP_PROVIDER,
      externalId: "def-JAX",
      type: "DEFENSE",
    })).toBe("DEF|JAX");
  });

  it("recognizes canonical nflcom defense entries", () => {
    expect(
      isCanonicalDefenseRankableEntry({
        position: "DEF",
        type: "DEFENSE",
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: canonicalDefenseExternalId("NE"),
        team: "NE",
      }),
    ).toBe(true);
    expect(
      isCanonicalDefenseRankableEntry({
        position: "DEF",
        type: "DEFENSE",
        provider: "manual",
        externalId: "manual-def-NE",
        team: "NE",
      }),
    ).toBe(false);
  });
});

describe("production pool source safeguards", () => {
  it("rejects mock and legacy manual defenses", () => {
    expect(isLegacyTestPoolProvider("mock")).toBe(true);
    expect(
      isProductionWeeklyPoolIdentity({
        provider: "mock",
        externalId: "mock-def-MIN",
        position: "DEF",
        type: "DEFENSE",
        team: "MIN",
        active: true,
      }),
    ).toBe(false);
    expect(
      isProductionWeeklyPoolIdentity({
        provider: "manual",
        externalId: "manual-def-NE",
        position: "DEF",
        type: "DEFENSE",
        team: "NE",
        active: true,
      }),
    ).toBe(false);
  });

  it("accepts nflcom bootstrap players and defenses", () => {
    expect(
      isProductionWeeklyPoolIdentity({
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: "justin-jefferson",
        position: "WR",
        type: "PLAYER",
        team: "MIN",
        active: true,
      }),
    ).toBe(true);
  });
});

describe("mutable weekly pool guards", () => {
  it("treats locked/finalized weeks as immutable", () => {
    expect(isMutableWeekStatus("OPEN")).toBe(true);
    expect(isMutableWeekStatus("LOCKED")).toBe(false);
    expect(isMutableContestStatus("OPEN")).toBe(true);
    expect(isMutableContestStatus("FINAL")).toBe(false);
  });
});

describe("weekly pool sync integration", () => {
  const suffix = `pool-integrity-${Date.now()}`;

  it("prunes stale legacy mock entries from open week and preserves admin exclusions", async () => {
    const season = await prisma.season.create({
      data: {
        year: 2093,
        sport: `TEST-POOL-${suffix}`,
        active: false,
      },
    });
    const week = await prisma.week.create({
      data: {
        seasonId: season.id,
        weekNumber: 1,
        label: `Week 1 ${suffix}`,
        startsAt: new Date("2093-09-07T00:00:00Z"),
        endsAt: new Date("2093-09-14T00:00:00Z"),
        status: "OPEN",
      },
    });
    await prisma.nflGame.create({
      data: {
        provider: "test",
        externalId: `game-${suffix}`,
        seasonId: season.id,
        weekId: week.id,
        seasonYear: 2093,
        weekNumber: 1,
        homeTeam: "MIN",
        awayTeam: "GB",
        startsAt: new Date("2093-09-07T17:00:00Z"),
      },
    });

    const contest = await prisma.rankIQContest.create({
      data: {
        seasonId: season.id,
        weekId: week.id,
        position: "RB",
        title: "RB",
        rankingDepth: 10,
        status: "OPEN",
      },
    });

    const canonical = await prisma.rankableEntry.create({
      data: {
        provider: NFL_COM_BOOTSTRAP_PROVIDER,
        externalId: `rb-canonical-${suffix}`,
        type: "PLAYER",
        name: "Canonical Back",
        shortName: "Back",
        team: "MIN",
        position: "RB",
        opponent: "TBD",
        active: true,
      },
    });
    const legacy = await prisma.rankableEntry.create({
      data: {
        provider: "mock",
        externalId: `mock-rb-${suffix}`,
        type: "PLAYER",
        name: "Legacy Back",
        shortName: "Back",
        team: "MIN",
        position: "RB",
        opponent: "TBD",
        active: true,
      },
    });

    await prisma.seasonPlayer.create({
      data: {
        seasonId: season.id,
        rankableEntryId: canonical.id,
        displayName: "Canonical Back",
        team: "MIN",
        position: "RB",
        nflStatus: "ACTIVE",
        activeOnNFLRoster: true,
      },
    });

    await prisma.contestEntry.create({
      data: {
        contestId: contest.id,
        rankableEntryId: legacy.id,
        weekTeam: "MIN",
        excluded: false,
      },
    });
    await prisma.contestEntry.create({
      data: {
        contestId: contest.id,
        rankableEntryId: canonical.id,
        weekTeam: "MIN",
        excluded: true,
        inactiveReason: "Admin hold",
        manuallyAdded: false,
      },
    });

    const result = await syncWeeklyEligibleFieldFromSeason({
      weekId: week.id,
      position: "RB",
      scheduledTeamsOnly: true,
    });

    expect(result.pruned).toBeGreaterThanOrEqual(1);

    const legacyEntry = await prisma.contestEntry.findFirst({
      where: { contestId: contest.id, rankableEntryId: legacy.id },
    });
    expect(legacyEntry?.excluded).toBe(true);

    const adminHeld = await prisma.contestEntry.findFirst({
      where: { contestId: contest.id, rankableEntryId: canonical.id },
    });
    expect(adminHeld?.excluded).toBe(true);
    expect(adminHeld?.inactiveReason).toBe("Admin hold");

    await prisma.season.delete({ where: { id: season.id } });
  });

  it("does not rewrite finalized contest pools", async () => {
    const season = await prisma.season.create({
      data: {
        year: 2092,
        sport: `TEST-FINAL-${suffix}`,
        active: false,
      },
    });
    const week = await prisma.week.create({
      data: {
        seasonId: season.id,
        weekNumber: 2,
        label: `Week 2 ${suffix}`,
        startsAt: new Date("2092-09-14T00:00:00Z"),
        endsAt: new Date("2092-09-21T00:00:00Z"),
        status: "LOCKED",
      },
    });
    const contest = await prisma.rankIQContest.create({
      data: {
        seasonId: season.id,
        weekId: week.id,
        position: "QB",
        title: "QB",
        rankingDepth: 10,
        status: "FINAL",
      },
    });
    const player = await prisma.rankableEntry.create({
      data: {
        provider: "mock",
        externalId: `mock-final-${suffix}`,
        type: "PLAYER",
        name: "Frozen QB",
        shortName: "QB",
        team: "MIN",
        position: "QB",
        opponent: "TBD",
        active: true,
      },
    });
    await prisma.contestEntry.create({
      data: {
        contestId: contest.id,
        rankableEntryId: player.id,
        weekTeam: "MIN",
        excluded: false,
      },
    });

    expect(await isMutableWeeklyPool(week.id)).toBe(false);

    const result = await syncWeeklyEligibleFieldFromSeason({
      weekId: week.id,
      position: "QB",
      scheduledTeamsOnly: false,
    });

    const stillActive = await prisma.contestEntry.findFirst({
      where: { contestId: contest.id, rankableEntryId: player.id, excluded: false },
    });
    expect(stillActive).toBeTruthy();
    expect(result.pruned).toBe(0);

    await prisma.season.delete({ where: { id: season.id } });
  });

  it("enforces exactly one DEF franchise per team on full slate weeks", async () => {
    const week = await prisma.week.findFirst({
      where: {
        weekNumber: 1,
        isTest: false,
        season: { active: true, sport: "NFL" },
      },
    });
    if (!week) return;

    const validation = await validateDefenseFranchiseUniqueness(week.id);
    expect(validation.ok).toBe(true);
    expect(validation.franchises).toBe(32);
  });
});
