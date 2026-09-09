import { describe, expect, it } from "vitest";
import {
  detectHotStreak,
  detectThreeWeekHeater,
  evaluateAthleteBadges,
  evaluateCompetitorBadges,
  listAthleteBadgeDefinitions,
  listCompetitorBadgeDefinitions,
  listPhase1BadgeDefinitions,
  listReservedBadgeCategories,
  maxRankForPercentile,
  qualifiesForTopPercentile,
  qualifyLeaderboardRows,
  COMPETITOR_BADGE_THRESHOLDS,
} from "@/lib/badges";
import type { LeaderboardRow } from "@/lib/leaderboards";
import type { ProfileContestHistoryItem } from "@/types/profile";
import type { RankIQProfileStats } from "@/types/user";
import type { PlayerWeeklyProfileRow } from "@/lib/player-profile";

function lb(
  id: string,
  averageScore: number,
  contestsPlayed: number,
): LeaderboardRow {
  return {
    universalProfileId: id,
    username: id,
    displayName: id,
    avatarUrl: null,
    profileType: "HUMAN",
    expertPublisher: null,
    expertSourceKind: null,
    creatorBrand: null,
    contestsPlayed,
    averageScore,
    bestScore: averageScore,
    topNHits: 0,
    topNOpportunities: 0,
    topNHitRate: 0,
    exactHits: 0,
    numberOneHits: 0,
    rank: 0,
  };
}

const emptyStats: RankIQProfileStats = {
  overallRank: null,
  averageRankingScore: null,
  topHitRate: null,
  exactRankingHits: 0,
  numberOneHits: 0,
  podiumHits: 0,
  bestWeek: null,
  currentStreak: null,
  positionRanks: { qb: null, rb: null, wr: null, te: null, def: null },
};

describe("badge catalog", () => {
  it("lists Phase 1 competitor + athlete badges and reserves monthly/market", () => {
    expect(listCompetitorBadgeDefinitions().length).toBeGreaterThanOrEqual(18);
    expect(listAthleteBadgeDefinitions().map((d) => d.id)).toEqual([
      "POSITION_WINNER",
      "PODIUM_FINISH",
      "TOP_10_FINISH",
      "THREE_WEEK_HEATER",
    ]);
    expect(listPhase1BadgeDefinitions().every((d) => d.phase === 1)).toBe(true);
    expect(listReservedBadgeCategories()).toEqual(["monthly", "market"]);
  });
});

describe("percentile helpers", () => {
  it("maps cohort size to max qualifying rank", () => {
    expect(maxRankForPercentile(100, 0.01)).toBe(1);
    expect(maxRankForPercentile(100, 0.05)).toBe(5);
    expect(maxRankForPercentile(100, 0.1)).toBe(10);
    expect(maxRankForPercentile(20, 0.01)).toBe(1);
    expect(maxRankForPercentile(20, 0.1)).toBe(2);
  });

  it("requires minimum contests before percentile ranking", () => {
    const rows = [
      lb("a", 90, 5),
      lb("b", 88, 5),
      lb("c", 95, 2), // under min
      lb("d", 70, 5),
    ];
    const qualified = qualifyLeaderboardRows(rows, 5);
    expect(qualified.map((row) => row.universalProfileId)).toEqual([
      "a",
      "b",
      "d",
    ]);
    expect(qualified[0].qualifiedRank).toBe(1);
    expect(
      qualifiesForTopPercentile({
        rank: 1,
        cohortSize: qualified.length,
        percentile: 0.1,
      }),
    ).toBe(true);
  });
});

describe("competitor badge evaluation", () => {
  it("awards overall Top % only when qualified participation is met", () => {
    const overallBoard = Array.from({ length: 20 }, (_, index) =>
      lb(`p${index}`, 100 - index, COMPETITOR_BADGE_THRESHOLDS.minOverallContests),
    );
    // Under-participating leader should not get percentile badges
    overallBoard[0] = lb("star", 99, 2);

    const earned = evaluateCompetitorBadges({
      profileId: "star",
      stats: emptyStats,
      history: [],
      overallBoard,
      positionBoards: {},
    });
    expect(earned.some((badge) => badge.id.startsWith("TOP_"))).toBe(false);

    overallBoard[0] = lb("star", 100, 5);
    // Keep others strictly below so star is alone at #1
    for (let index = 1; index < overallBoard.length; index += 1) {
      overallBoard[index] = lb(`p${index}`, 90 - index, 5);
    }
    const earnedOk = evaluateCompetitorBadges({
      profileId: "star",
      stats: emptyStats,
      history: [],
      overallBoard,
      positionBoards: {},
    });
    expect(earnedOk.map((badge) => badge.id)).toEqual(
      expect.arrayContaining([
        "TOP_1_OVERALL",
        "TOP_5_OVERALL",
        "TOP_10_OVERALL",
      ]),
    );
  });

  it("awards position Top % with position-specific min contests", () => {
    const rbBoard = Array.from({ length: 10 }, (_, index) =>
      lb(`rb${index}`, 90 - index, COMPETITOR_BADGE_THRESHOLDS.minPositionContests),
    );
    const earned = evaluateCompetitorBadges({
      profileId: "rb0",
      stats: emptyStats,
      history: [],
      overallBoard: [],
      positionBoards: { RB: rbBoard },
    });
    expect(earned.map((badge) => badge.id)).toEqual(
      expect.arrayContaining(["TOP_1_RB", "TOP_5_RB", "TOP_10_RB"]),
    );
    expect(earned.some((badge) => badge.id.includes("QB"))).toBe(false);
  });

  it("awards Exact Hit and Podium Call from stats", () => {
    const earned = evaluateCompetitorBadges({
      profileId: "x",
      stats: {
        ...emptyStats,
        exactRankingHits: 2,
        podiumHits: 1,
      },
      history: [],
      overallBoard: [],
      positionBoards: {},
    });
    expect(earned.map((badge) => badge.id)).toEqual(
      expect.arrayContaining(["EXACT_HIT", "PODIUM_CALL"]),
    );
  });

  it("detects Hot Streak across consecutive weeks", () => {
    const history: ProfileContestHistoryItem[] = [
      hist(1, 82),
      hist(2, 85),
      hist(3, 81),
      hist(5, 90), // broken streak
    ];
    expect(detectHotStreak(history).earned).toBe(true);
    expect(detectHotStreak([hist(1, 82), hist(2, 70)]).earned).toBe(false);
  });
});

describe("athlete badge evaluation", () => {
  it("awards finish badges from season summary", () => {
    const earned = evaluateAthleteBadges({
      summary: {
        weeksRecorded: 4,
        weeksEligible: 4,
        fantasyPpg: 18,
        averageFinish: 4,
        medianFinish: 3,
        bestFinish: 1,
        worstFinish: 12,
        numberOneFinishes: 1,
        top3Finishes: 2,
        top5Finishes: 3,
        top10Finishes: 4,
      },
      weeklyHistory: [],
    });
    expect(earned.map((badge) => badge.id)).toEqual([
      "POSITION_WINNER",
      "PODIUM_FINISH",
      "TOP_10_FINISH",
    ]);
  });

  it("detects 3-Week Heater on consecutive Top 10 finishes", () => {
    const weeklyHistory: PlayerWeeklyProfileRow[] = [
      week(1, 8),
      week(2, 4),
      week(3, 9),
      week(4, 15),
    ];
    expect(detectThreeWeekHeater(weeklyHistory).earned).toBe(true);
    expect(detectThreeWeekHeater([week(1, 8), week(2, 12), week(3, 2)]).earned).toBe(
      false,
    );

    const earned = evaluateAthleteBadges({
      summary: {
        weeksRecorded: 4,
        weeksEligible: 4,
        fantasyPpg: null,
        averageFinish: null,
        medianFinish: null,
        bestFinish: 4,
        worstFinish: 15,
        numberOneFinishes: 0,
        top3Finishes: 0,
        top5Finishes: 1,
        top10Finishes: 3,
      },
      weeklyHistory,
    });
    expect(earned.some((badge) => badge.id === "THREE_WEEK_HEATER")).toBe(true);
  });
});

function hist(weekNumber: number, score: number): ProfileContestHistoryItem {
  return {
    submissionId: `s-${weekNumber}`,
    contestId: `c-${weekNumber}`,
    weekLabel: `Week ${weekNumber}`,
    weekNumber,
    position: "RB",
    rankingDepth: 10,
    normalizedScore: score,
    rawScore: score,
    topNHits: 0,
    exactHits: 0,
    numberOneHit: false,
    weeklyRank: 1,
    receiptPicks: [],
  };
}

function week(weekNumber: number, actualRank: number): PlayerWeeklyProfileRow {
  return {
    weekId: `w-${weekNumber}`,
    weekLabel: `Week ${weekNumber}`,
    weekNumber,
    contestId: `c-${weekNumber}`,
    position: "RB",
    team: "ATL",
    opponent: "vs MIN",
    fantasyPoints: 20,
    actualRank,
    graded: true,
    market: null,
    marketPrivate: false,
  };
}
