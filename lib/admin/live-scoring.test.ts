import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  calculateDefenseLiveFantasyPoints,
  calculatePlayerLiveFantasyPoints,
  clearLiveStats,
  LIVE_MANUAL_PROVIDER,
  saveLiveDefenseStats,
  saveLivePlayerStats,
} from "@/lib/admin/live-scoring";
import { prisma } from "@/lib/db";
import { FANTASYTRACK_NFL_HALF_PPR_V2 } from "@/lib/fantasy/scoring-config";
import { scoreWeeklyPlayerFantasy } from "@/lib/fantasy/shared-engine";
import { getLivePlayerStandings } from "@/lib/live-rankiq";
import { zonedLocalToUtc } from "@/lib/timing/chicago";

const suffix = `live${Date.now()}`;

describe("live scoring — canonical V2 from raw stats", () => {
  it("scores pass yards / TD / INT with 299 vs 300 bonus threshold", () => {
    const under = calculatePlayerLiveFantasyPoints(
      { passingYards: 299, passingTds: 2, interceptions: 1 },
      FANTASYTRACK_NFL_HALF_PPR_V2,
    );
    const over = calculatePlayerLiveFantasyPoints(
      { passingYards: 300, passingTds: 2, interceptions: 1 },
      FANTASYTRACK_NFL_HALF_PPR_V2,
    );
    // 299/25 + 8 - 2 = 17.96; 300/25 + 8 - 2 + 5 = 23
    expect(under).toBeCloseTo(299 / 25 + 8 - 2, 5);
    expect(over).toBe(12 + 8 - 2 + 5);
    expect(over - under).toBeCloseTo(300 / 25 - 299 / 25 + 5, 5);
  });

  it("scores rush yards / TD with 99 vs 100 bonus", () => {
    const under = calculatePlayerLiveFantasyPoints({
      rushingYards: 99,
      rushingTds: 1,
    });
    const over = calculatePlayerLiveFantasyPoints({
      rushingYards: 100,
      rushingTds: 1,
    });
    expect(under).toBeCloseTo(9.9 + 6, 5);
    expect(over).toBe(10 + 6 + 5);
  });

  it("scores receptions / receiving yards / TD with 99 vs 100 bonus", () => {
    const under = calculatePlayerLiveFantasyPoints({
      receptions: 4,
      receivingYards: 99,
      receivingTds: 1,
    });
    const over = calculatePlayerLiveFantasyPoints({
      receptions: 4,
      receivingYards: 100,
      receivingTds: 1,
    });
    expect(under).toBeCloseTo(2 + 9.9 + 6, 5);
    expect(over).toBe(2 + 10 + 6 + 5);
  });

  it("scores fumble lost, 2PT, return TD, and stacked yardage bonuses", () => {
    const result = calculatePlayerLiveFantasyPoints({
      passingYards: 300,
      rushingYards: 100,
      receivingYards: 100,
      receptions: 2,
      fumblesLost: 1,
      twoPointConversions: 1,
      returnTds: 1,
    });
    // 12 + 10 + 10 + 1 + 15 bonuses + 2 - 2 + 6 = 54
    expect(result).toBe(54);
  });

  it("matches scoreWeeklyPlayerFantasy (single source of truth)", () => {
    const stats = {
      passingYards: 275,
      passingTds: 2,
      interceptions: 1,
      rushingYards: 30,
    };
    expect(calculatePlayerLiveFantasyPoints(stats)).toBe(
      scoreWeeklyPlayerFantasy(stats).fantasyPoints,
    );
    // 275/25=11, 8, -2, 3 = 20
    expect(calculatePlayerLiveFantasyPoints(stats)).toBe(20);
  });

  it("scores D/ST points-allowed tiers and plays", () => {
    expect(calculateDefenseLiveFantasyPoints({ pointsAllowed: 0 })).toBe(10);
    expect(calculateDefenseLiveFantasyPoints({ pointsAllowed: 6 })).toBe(7);
    expect(calculateDefenseLiveFantasyPoints({ pointsAllowed: 13 })).toBe(4);
    expect(calculateDefenseLiveFantasyPoints({ pointsAllowed: 20 })).toBe(1);
    expect(calculateDefenseLiveFantasyPoints({ pointsAllowed: 27 })).toBe(0);
    expect(calculateDefenseLiveFantasyPoints({ pointsAllowed: 34 })).toBe(-1);
    expect(calculateDefenseLiveFantasyPoints({ pointsAllowed: 35 })).toBe(-4);

    expect(
      calculateDefenseLiveFantasyPoints({
        sacks: 2,
        interceptions: 1,
        fumbleRecoveries: 1,
        defensiveTds: 1,
        specialTeamsTds: 1,
        safeties: 1,
        blockedKicks: 1,
        pointsAllowed: 21,
      }),
    ).toBe(2 + 2 + 2 + 6 + 6 + 2 + 2 + 0);
  });

  it("allows negative calculated fantasy scores", () => {
    expect(
      calculatePlayerLiveFantasyPoints({
        interceptions: 3,
        fumblesLost: 2,
      }),
    ).toBe(-10);
    expect(
      calculateDefenseLiveFantasyPoints({
        pointsAllowed: 40,
      }),
    ).toBe(-4);
  });
});

describe("live scoring persistence + public visibility", () => {
  let seasonId = "";
  let weekId = "";
  let gameId = "";
  let qbContestId = "";
  let defContestId = "";
  let qbEntryId = "";
  let qbBenchedEntryId = "";
  let defEntryId = "";
  let qbRankableId = "";
  let qbBenchedRankableId = "";
  let defRankableId = "";
  let adminUserId = "";

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2098,
        sport: `LIVE-${suffix}`,
        active: false,
        fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
      },
    });
    seasonId = season.id;

    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: "Live Test W1",
        startsAt: zonedLocalToUtc(2026, 9, 7, 12, 0),
        endsAt: zonedLocalToUtc(2026, 9, 11, 23, 0),
        status: "OPEN",
        fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
      },
    });
    weekId = week.id;

    const game = await prisma.nflGame.create({
      data: {
        provider: "manual",
        externalId: `live-game-${suffix}`,
        seasonId,
        weekId,
        seasonYear: 2098,
        weekNumber: 1,
        homeTeam: "KC",
        awayTeam: "BAL",
        startsAt: zonedLocalToUtc(2026, 9, 7, 12, 0),
        status: "SCHEDULED",
      },
    });
    gameId = game.id;

    const admin = await prisma.user.create({
      data: { email: `live-admin-${suffix}@example.com`, role: "ADMIN" },
    });
    adminUserId = admin.id;

    const qb = await prisma.rankableEntry.create({
      data: {
        provider: "manual",
        externalId: `live-qb-${suffix}`,
        name: "Live QB",
        shortName: "L. QB",
        team: "KC",
        opponent: "BAL",
        position: "QB",
        type: "PLAYER",
        gameId,
      },
    });
    qbRankableId = qb.id;

    const qbBench = await prisma.rankableEntry.create({
      data: {
        provider: "manual",
        externalId: `live-qb-bench-${suffix}`,
        name: "Unplayed QB",
        shortName: "U. QB",
        team: "KC",
        opponent: "BAL",
        position: "QB",
        type: "PLAYER",
        gameId,
      },
    });
    qbBenchedRankableId = qbBench.id;

    const def = await prisma.rankableEntry.create({
      data: {
        provider: "manual",
        externalId: `live-def-${suffix}`,
        name: "Chiefs D/ST",
        shortName: "KC DEF",
        team: "KC",
        opponent: "BAL",
        position: "DEF",
        type: "DEFENSE",
        gameId,
      },
    });
    defRankableId = def.id;

    const qbContest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "QB",
        title: `QB Live ${suffix}`,
        status: "OPEN",
        rankingDepth: 10,
      },
    });
    qbContestId = qbContest.id;

    const defContest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "DEF",
        title: `DEF Live ${suffix}`,
        status: "OPEN",
        rankingDepth: 10,
      },
    });
    defContestId = defContest.id;

    const qbEntry = await prisma.contestEntry.create({
      data: {
        contestId: qbContestId,
        rankableEntryId: qbRankableId,
        gameId,
      },
    });
    qbEntryId = qbEntry.id;

    const qbBenchEntry = await prisma.contestEntry.create({
      data: {
        contestId: qbContestId,
        rankableEntryId: qbBenchedRankableId,
        gameId,
      },
    });
    qbBenchedEntryId = qbBenchEntry.id;

    const defEntry = await prisma.contestEntry.create({
      data: {
        contestId: defContestId,
        rankableEntryId: defRankableId,
        gameId,
      },
    });
    defEntryId = defEntry.id;
  });

  afterAll(async () => {
    await prisma.playerWeekStat.deleteMany({ where: { weekId } });
    await prisma.defenseWeekStat.deleteMany({ where: { weekId } });
    await prisma.contestEntry.deleteMany({
      where: { contest: { weekId } },
    });
    await prisma.rankIQContest.deleteMany({ where: { weekId } });
    await prisma.nflGame.deleteMany({ where: { weekId } });
    await prisma.week.deleteMany({ where: { id: weekId } });
    await prisma.rankableEntry.deleteMany({
      where: { externalId: { startsWith: `live-` } },
    });
    await prisma.user.deleteMany({ where: { id: adminUserId } });
    await prisma.season.deleteMany({ where: { id: seasonId } });
    await prisma.$disconnect();
  });

  it("hides unplayed players until a live stat record is saved", async () => {
    const before = await getLivePlayerStandings(qbContestId);
    expect(before.map((row) => row.rankableEntryId)).not.toContain(
      qbRankableId,
    );
    expect(before.map((row) => row.rankableEntryId)).not.toContain(
      qbBenchedRankableId,
    );
  });

  it("saves raw stats, calculates FP, and updates public live board", async () => {
    const q1 = await saveLivePlayerStats({
      contestEntryId: qbEntryId,
      adminUserId,
      stats: { rushingYards: 48 },
    });
    expect(q1.skipped).toBe(false);
    expect(q1.fantasyPoints).toBeCloseTo(4.8, 5);

    let standings = await getLivePlayerStandings(qbContestId);
    expect(standings).toHaveLength(1);
    expect(standings[0]?.fantasyPoints).toBeCloseTo(4.8, 5);

    const q2 = await saveLivePlayerStats({
      contestEntryId: qbEntryId,
      adminUserId,
      stats: { rushingYards: 76, rushingTds: 1 },
    });
    expect(q2.fantasyPoints).toBeCloseTo(13.6, 5);

    const weekStats = await prisma.playerWeekStat.findMany({
      where: {
        provider: LIVE_MANUAL_PROVIDER,
        weekId,
        rankableEntryId: qbRankableId,
      },
    });
    expect(weekStats).toHaveLength(1);
    expect(weekStats[0]?.rushingYards).toBe(76);
    expect(weekStats[0]?.rushingTds).toBe(1);
    expect(weekStats[0]?.isProvisional).toBe(true);
    expect(weekStats[0]?.fantasyPoints).toBeCloseTo(13.6, 5);

    standings = await getLivePlayerStandings(qbContestId);
    expect(standings[0]?.fantasyPoints).toBeCloseTo(13.6, 5);
    expect(standings.map((row) => row.rankableEntryId)).not.toContain(
      qbBenchedRankableId,
    );
  });

  it("shows negative calculated scores when a live line exists", async () => {
    await saveLivePlayerStats({
      contestEntryId: qbEntryId,
      adminUserId,
      stats: { interceptions: 2, fumblesLost: 1 },
    });
    const standings = await getLivePlayerStandings(qbContestId);
    expect(standings[0]?.fantasyPoints).toBe(-6);
  });

  it("does not set actualRank or contest FINAL from live saves", async () => {
    await saveLivePlayerStats({
      contestEntryId: qbEntryId,
      adminUserId,
      stats: { passingYards: 275, passingTds: 2, interceptions: 1, rushingYards: 30 },
    });
    const entry = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: qbEntryId },
    });
    const contest = await prisma.rankIQContest.findUniqueOrThrow({
      where: { id: qbContestId },
    });
    expect(entry.actualRank).toBeNull();
    expect(entry.fantasyPoints).toBe(20);
    expect(contest.status).toBe("OPEN");
  });

  it("saves D/ST stats via canonical defense scorer", async () => {
    const result = await saveLiveDefenseStats({
      contestEntryId: defEntryId,
      adminUserId,
      stats: {
        sacks: 3,
        interceptions: 1,
        pointsAllowed: 14,
      },
    });
    expect(result.fantasyPoints).toBe(3 + 2 + 1);

    const standings = await getLivePlayerStandings(defContestId);
    expect(standings).toHaveLength(1);
    expect(standings[0]?.fantasyPoints).toBe(6);
  });

  it("clears live line and hides player again", async () => {
    await clearLiveStats({ contestEntryId: qbBenchedEntryId, adminUserId });
    await saveLivePlayerStats({
      contestEntryId: qbBenchedEntryId,
      adminUserId,
      stats: { rushingYards: 10 },
    });
    let standings = await getLivePlayerStandings(qbContestId);
    expect(standings.map((r) => r.rankableEntryId)).toContain(
      qbBenchedRankableId,
    );

    await clearLiveStats({ contestEntryId: qbBenchedEntryId, adminUserId });
    standings = await getLivePlayerStandings(qbContestId);
    expect(standings.map((r) => r.rankableEntryId)).not.toContain(
      qbBenchedRankableId,
    );
    const leftover = await prisma.playerWeekStat.count({
      where: {
        provider: LIVE_MANUAL_PROVIDER,
        weekId,
        rankableEntryId: qbBenchedRankableId,
      },
    });
    expect(leftover).toBe(0);
  });

  it("allows provider/final stats to replace manual live ContestEntry points", async () => {
    await saveLivePlayerStats({
      contestEntryId: qbEntryId,
      adminUserId,
      stats: { rushingYards: 50 },
    });
    const liveFp = (
      await prisma.contestEntry.findUniqueOrThrow({ where: { id: qbEntryId } })
    ).fantasyPoints;
    expect(liveFp).toBe(5);

    await prisma.playerWeekStat.create({
      data: {
        provider: "sportsdata",
        weekId,
        rankableEntryId: qbRankableId,
        gameId,
        externalPlayerId: `provider-qb-${suffix}`,
        scoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
        rushingYards: 120,
        rushingTds: 1,
        fantasyPoints: 23,
        isProvisional: false,
      },
    });
    await prisma.contestEntry.update({
      where: { id: qbEntryId },
      data: { fantasyPoints: 23 },
    });

    const entry = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: qbEntryId },
    });
    expect(entry.fantasyPoints).toBe(23);

    const manual = await prisma.playerWeekStat.findFirst({
      where: {
        provider: LIVE_MANUAL_PROVIDER,
        weekId,
        rankableEntryId: qbRankableId,
      },
    });
    const provider = await prisma.playerWeekStat.findFirst({
      where: {
        provider: "sportsdata",
        weekId,
        rankableEntryId: qbRankableId,
        isProvisional: false,
      },
    });
    expect(manual?.isProvisional).toBe(true);
    expect(provider?.fantasyPoints).toBe(23);
  });
});
