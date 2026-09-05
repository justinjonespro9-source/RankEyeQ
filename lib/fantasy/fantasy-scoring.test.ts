import {
  FANTASYTRACK_NFL_FULL_PPR_V1,
  FANTASYTRACK_NFL_HALF_PPR_V1,
  FANTASYTRACK_NFL_HALF_PPR_V2,
  getFantasyRules,
} from "@/lib/fantasy/scoring-config";
import { calculateActualFinishesForContest } from "@/lib/nfl/actual-finishes";
import { getFinalizeWeekReadiness } from "@/lib/nfl/finalize-week";
import { commitWeekResults } from "@/lib/nfl/results-import";
import { commitWeeklyImport } from "@/lib/nfl/import";
import { buildRankIqPositionPools } from "@/lib/nfl/pool-builder";
import { MockNflProvider } from "@/lib/providers/nfl/mock/provider";
import { scorePlayerPick } from "@/lib/scoring";
import { scorePlayerFantasy } from "@/lib/fantasy/player-scoring";
import { scoreDefenseFantasy } from "@/lib/fantasy/defense-scoring";
import { assignCompetitionRanks } from "@/lib/fantasy/competition-rank";
import { prisma } from "@/lib/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("player fantasy scoring (FantasyTrack Half PPR V2 default)", () => {
  it("scores QB passing yards/TDs/INTs without milestone under 300", () => {
    const result = scorePlayerFantasy({
      passingYards: 250,
      passingTds: 2,
      interceptions: 1,
    });
    // 250/25=10, 2*4=8, -2 = 16
    expect(result.fantasyPoints).toBe(16);
    expect(result.components.passingYardsBonus).toBe(0);
  });

  it("scores RB rush + half-PPR receptions with 100-yard rush bonus", () => {
    const result = scorePlayerFantasy({
      rushingYards: 100,
      rushingTds: 1,
      receptions: 4,
      receivingYards: 30,
    });
    // 10 + 6 + 2 + 3 + 5 rush bonus = 26
    expect(result.fantasyPoints).toBe(26);
    expect(result.components.rushingYardsBonus).toBe(5);
  });

  it("scores WR receiving Half PPR with 100-yard receiving bonus", () => {
    const result = scorePlayerFantasy({
      receptions: 8,
      receivingYards: 120,
      receivingTds: 1,
    });
    // 4 + 12 + 6 + 5 receiving bonus = 27
    expect(result.fantasyPoints).toBe(27);
    expect(result.components.receivingYardsBonus).toBe(5);
  });

  it("scores TE similarly and applies fumbles / 2PT", () => {
    const result = scorePlayerFantasy({
      receptions: 5,
      receivingYards: 50,
      twoPointConversions: 1,
      fumblesLost: 1,
    });
    // 2.5 + 5 + 2 - 2 = 7.5
    expect(result.fantasyPoints).toBe(7.5);
  });

  it("applies one-time 300+ passing yard bonus", () => {
    const at299 = scorePlayerFantasy({ passingYards: 299 });
    const at300 = scorePlayerFantasy({ passingYards: 300 });
    const at400 = scorePlayerFantasy({ passingYards: 400 });
    expect(at299.components.passingYardsBonus).toBe(0);
    expect(at300.components.passingYardsBonus).toBe(5);
    expect(at400.components.passingYardsBonus).toBe(5);
    expect(at300.fantasyPoints - at299.fantasyPoints).toBeCloseTo(
      300 / 25 - 299 / 25 + 5,
      5,
    );
  });

  it("applies one-time rush and receiving bonuses that stack", () => {
    const result = scorePlayerFantasy({
      rushingYards: 100,
      receivingYards: 100,
      receptions: 2,
    });
    // 10 + 10 + 1 + 5 + 5 = 31
    expect(result.fantasyPoints).toBe(31);
    expect(result.components.rushingYardsBonus).toBe(5);
    expect(result.components.receivingYardsBonus).toBe(5);
  });

  it("stacks all three milestone bonuses when thresholds are met", () => {
    const result = scorePlayerFantasy({
      passingYards: 300,
      rushingYards: 100,
      receivingYards: 100,
    });
    expect(result.components.passingYardsBonus).toBe(5);
    expect(result.components.rushingYardsBonus).toBe(5);
    expect(result.components.receivingYardsBonus).toBe(5);
    // 12 + 10 + 10 + 15 bonuses = 47
    expect(result.fantasyPoints).toBe(47);
  });
});

describe("historical Half PPR V1 and Full PPR remain reproducible", () => {
  it("Half PPR V1 does not award yardage milestones", () => {
    const { player } = getFantasyRules(FANTASYTRACK_NFL_HALF_PPR_V1);
    const result = scorePlayerFantasy(
      {
        rushingYards: 100,
        rushingTds: 1,
        receptions: 4,
        receivingYards: 30,
      },
      player,
    );
    expect(result.fantasyPoints).toBe(21);
    expect(result.components.rushingYardsBonus).toBe(0);
  });

  it("still scores 1.0 per reception when Full PPR rules are passed", () => {
    const { player } = getFantasyRules(FANTASYTRACK_NFL_FULL_PPR_V1);
    const result = scorePlayerFantasy(
      {
        receptions: 8,
        receivingYards: 120,
        receivingTds: 1,
      },
      player,
    );
    expect(result.fantasyPoints).toBe(26);
    expect(result.components.receivingYardsBonus).toBe(0);
  });
});

describe("D/ST fantasy scoring", () => {
  it("applies points-allowed tiers and defensive plays", () => {
    const shutout = scoreDefenseFantasy({
      sacks: 3,
      interceptions: 1,
      fumbleRecoveries: 1,
      defensiveTds: 1,
      pointsAllowed: 0,
    });
    // 3 + 2 + 2 + 6 + 10 = 23
    expect(shutout.fantasyPoints).toBe(23);
    expect(shutout.pointsAllowedPoints).toBe(10);

    expect(scoreDefenseFantasy({ pointsAllowed: 6 }).pointsAllowedPoints).toBe(
      7,
    );
    expect(scoreDefenseFantasy({ pointsAllowed: 14 }).pointsAllowedPoints).toBe(
      1,
    );
    expect(scoreDefenseFantasy({ pointsAllowed: 28 }).pointsAllowedPoints).toBe(
      -1,
    );
    expect(scoreDefenseFantasy({ pointsAllowed: 40 }).pointsAllowedPoints).toBe(
      -4,
    );
  });
});

describe("competition ranking + RankIQ tie scoring", () => {
  it("assigns 1,2,2,4 ranks without name tie-breaks", () => {
    const ranked = assignCompetitionRanks(
      [
        { id: "a", pts: 30 },
        { id: "b", pts: 25 },
        { id: "c", pts: 25 },
        { id: "d", pts: 20 },
      ],
      (row) => row.pts,
    );
    expect(ranked.map((row) => row.rank)).toEqual([1, 2, 2, 4]);
  });

  it("credits exact hit against a tied actual rank with podium call scoring", () => {
    const exactOnTie = scorePlayerPick(
      {
        playerId: "c",
        playerName: "C",
        predictedRank: 2,
        actualRank: 2,
      },
      10,
    );
    expect(exactOnTie.exactHit).toBe(true);
    expect(exactOnTie.podiumCallPoints).toBe(10);
    expect(exactOnTie.actualPodiumPoints).toBe(15);
    expect(exactOnTie.totalPoints).toBe(35);

    const missedPodium = scorePlayerPick(
      {
        playerId: "d",
        playerName: "D",
        predictedRank: 2,
        actualRank: 4,
      },
      10,
    );
    expect(missedPodium.podiumCallPoints).toBe(0);
    expect(missedPodium.actualPodiumPoints).toBe(0);
    expect(missedPodium.precisionPoints).toBe(1);
    expect(missedPodium.totalPoints).toBe(11);
    expect(missedPodium.exactHit).toBe(false);
  });
});

describe("results import + finishes + finalize readiness", () => {
  const suffix = `res${Date.now()}`;
  const provider = new MockNflProvider(`mock-${suffix}`);
  let seasonId = "";
  let weekId = "";

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2097,
        sport: `NFL-${suffix}`,
        active: false,
      },
    });
    seasonId = season.id;
    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: "Results Week 1",
        startsAt: new Date("2026-09-03T00:00:00Z"),
        endsAt: new Date("2026-09-09T00:00:00Z"),
        status: "LOCKED",
        fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
      },
    });
    weekId = week.id;

    await commitWeeklyImport({
      seasonId,
      weekId,
      seasonYear: 2026,
      weekNumber: 1,
      provider,
    });
    await buildRankIqPositionPools({ weekId, provider });
  });

  afterAll(async () => {
    await prisma.rankingPick.deleteMany({
      where: { submission: { contest: { weekId } } },
    });
    await prisma.rankingSubmission.deleteMany({
      where: { contest: { weekId } },
    });
    await prisma.contestEntry.deleteMany({
      where: { contest: { weekId } },
    });
    await prisma.rankIQContest.deleteMany({ where: { weekId } });
    await prisma.playerWeekStat.deleteMany({ where: { weekId } });
    await prisma.defenseWeekStat.deleteMany({ where: { weekId } });
    await prisma.rankableEntry.updateMany({
      where: { provider: provider.name },
      data: { gameId: null },
    });
    await prisma.nflGame.deleteMany({ where: { weekId } });
    await prisma.rankableEntry.deleteMany({ where: { provider: provider.name } });
    await prisma.week.deleteMany({ where: { id: weekId } });
    await prisma.season.deleteMany({ where: { id: seasonId } });
  });

  it("imports stats idempotently and updates on re-import", async () => {
    const first = await commitWeekResults({ weekId, provider });
    expect(first.playersCreated).toBeGreaterThan(0);
    expect(first.defensesCreated).toBe(32);

    const second = await commitWeekResults({ weekId, provider });
    expect(second.playersCreated).toBe(0);
    expect(second.playersUpdated).toBe(first.playersCreated);
    expect(second.defensesCreated).toBe(0);
    expect(second.defensesUpdated).toBe(32);

    const zeros = await prisma.playerWeekStat.count({
      where: { weekId, fantasyPoints: 0 },
    });
    expect(zeros).toBeGreaterThan(0);

    const missingVsZeroReady = await getFinalizeWeekReadiness(weekId);
    // Stats exist; ranks may still be missing until finishes calculated.
    expect(missingVsZeroReady.entriesWithPoints).toBeGreaterThan(0);
  });

  it("calculates competition ranks including ties", async () => {
    await commitWeekResults({ weekId, provider });
    const qb = await prisma.rankIQContest.findUniqueOrThrow({
      where: { weekId_position: { weekId, position: "QB" } },
    });

    // Force a tie to verify competition ranking persistence.
    const entries = await prisma.contestEntry.findMany({
      where: { contestId: qb.id, excluded: false },
      take: 3,
      orderBy: { id: "asc" },
    });
    await prisma.contestEntry.update({
      where: { id: entries[0].id },
      data: { fantasyPoints: 50 },
    });
    await prisma.contestEntry.update({
      where: { id: entries[1].id },
      data: { fantasyPoints: 40 },
    });
    await prisma.contestEntry.update({
      where: { id: entries[2].id },
      data: { fantasyPoints: 40 },
    });

    for (const [entry, points] of [
      [entries[0], 50],
      [entries[1], 40],
      [entries[2], 40],
    ] as const) {
      await prisma.playerWeekStat.updateMany({
        where: { weekId, rankableEntryId: entry.rankableEntryId },
        data: { fantasyPoints: points },
      });
    }
    await prisma.playerWeekStat.updateMany({
      where: {
        weekId,
        rankableEntry: { position: "QB" },
        rankableEntryId: {
          notIn: entries.map((entry) => entry.rankableEntryId),
        },
      },
      data: { fantasyPoints: 0 },
    });

    await calculateActualFinishesForContest(qb.id);
    const ranks = await prisma.contestEntry.findMany({
      where: { id: { in: entries.map((entry) => entry.id) } },
      select: { id: true, actualRank: true, fantasyPoints: true },
    });
    const byId = new Map(ranks.map((row) => [row.id, row]));
    expect(byId.get(entries[0].id)?.actualRank).toBe(1);
    expect(byId.get(entries[1].id)?.actualRank).toBe(2);
    expect(byId.get(entries[2].id)?.actualRank).toBe(2);
  });

  it("blocks Finalize Week until ranks exist for Top N", async () => {
    // Reset ranks for a clean readiness check after forced ties test.
    await prisma.contestEntry.updateMany({
      where: { contest: { weekId } },
      data: { actualRank: null },
    });
    const before = await getFinalizeWeekReadiness(weekId);
    expect(before.ready).toBe(false);
    expect(
      before.reasons.some(
        (reason) =>
          reason.includes("actualRank") ||
          reason.includes("requires at least"),
      ),
    ).toBe(true);
  });
});
