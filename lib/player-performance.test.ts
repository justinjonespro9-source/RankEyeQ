import { describe, expect, it } from "vitest";
import {
  aggregatePlayerPerformance,
  isOfficialPlayerPerformanceStatus,
  lastCompletedFinalizedWeekNumbers,
  mapContestEntriesToPerformanceSource,
  parsePlayerPerformanceScope,
  qualificationForPlayerPerformanceScope,
  shouldShowPlayerPerformanceQualificationControls,
  sortWeekPerformanceRows,
  WEEK_LEADERBOARD_LIMIT,
  type PlayerPerformanceSourceRow,
  type WeekPerformanceRow,
} from "@/lib/player-performance";
import {
  avgRankedPositionFromSums,
  rankedPctFromSums,
  scoringDepthForRankedMetric,
  tallyScoringBoardSelection,
  topNThresholdForPosition,
} from "@/lib/player-performance-ranked";

function sourceRow(
  overrides: Partial<PlayerPerformanceSourceRow> & {
    rankableEntryId: string;
    name: string;
    actualRank: number | null;
    wasActive: boolean;
  },
): PlayerPerformanceSourceRow {
  return {
    team: "MIN",
    position: "RB",
    weekId: "w1",
    weekLabel: "Week 1",
    weekNumber: 1,
    contestId: "c1",
    weekTeam: "MIN",
    fantasyPoints: 10,
    contestFinal: true,
    consensusRank: null,
    scoringBoardSelections: 0,
    eligibleBallotCount: 0,
    scoringRankSum: 0,
    ...overrides,
  };
}

describe("official contest status gate", () => {
  it("includes FINAL and ARCHIVED only", () => {
    expect(isOfficialPlayerPerformanceStatus("FINAL")).toBe(true);
    expect(isOfficialPlayerPerformanceStatus("ARCHIVED")).toBe(true);
    expect(isOfficialPlayerPerformanceStatus("OPEN")).toBe(false);
    expect(isOfficialPlayerPerformanceStatus("LOCKED")).toBe(false);
    expect(isOfficialPlayerPerformanceStatus("GRADING")).toBe(false);
    expect(isOfficialPlayerPerformanceStatus("LIVE")).toBe(false);
  });

  it("season aggregation excludes non-final contest finishes", () => {
    const rows: PlayerPerformanceSourceRow[] = [
      sourceRow({
        rankableEntryId: "p1",
        name: "Player",
        actualRank: 2,
        wasActive: true,
        contestFinal: true,
        contestId: "final",
      }),
      sourceRow({
        rankableEntryId: "p1",
        name: "Player",
        actualRank: 1,
        wasActive: true,
        contestFinal: false,
        contestId: "open",
        weekId: "w2",
        weekNumber: 2,
      }),
    ];

    const [row] = aggregatePlayerPerformance(rows, { qualification: "ALL" });
    expect(row.weeksRecorded).toBe(1);
    expect(row.averageFinish).toBe(2);
    expect(row.bestFinish).toBe(2);
  });
});

describe("position-aware Top-N", () => {
  it("uses Top 15 for WR and Top 10 for other positions", () => {
    expect(topNThresholdForPosition("WR")).toBe(15);
    expect(topNThresholdForPosition("RB")).toBe(10);
    expect(topNThresholdForPosition("QB")).toBe(10);
    expect(topNThresholdForPosition("TE")).toBe(10);
    expect(topNThresholdForPosition("DEF")).toBe(10);
  });

  it("counts WR finishes through 15 as Top-N", () => {
    const wr = aggregatePlayerPerformance(
      [
        sourceRow({
          rankableEntryId: "wr1",
          name: "WR A",
          position: "WR",
          actualRank: 15,
          wasActive: true,
        }),
        sourceRow({
          rankableEntryId: "wr1",
          name: "WR A",
          position: "WR",
          actualRank: 16,
          wasActive: true,
          weekId: "w2",
          weekNumber: 2,
          contestId: "c2",
        }),
      ],
      { position: "WR" },
    )[0];

    expect(wr.topNThreshold).toBe(15);
    expect(wr.top10Finishes).toBe(1);
  });

  it("does not count RB16 as Top-N", () => {
    const rb = aggregatePlayerPerformance(
      [
        sourceRow({
          rankableEntryId: "rb1",
          name: "RB A",
          position: "RB",
          actualRank: 10,
          wasActive: true,
        }),
        sourceRow({
          rankableEntryId: "rb1",
          name: "RB A",
          position: "RB",
          actualRank: 11,
          wasActive: true,
          weekId: "w2",
          weekNumber: 2,
          contestId: "c2",
        }),
      ],
      { position: "RB" },
    )[0];

    expect(rb.topNThreshold).toBe(10);
    expect(rb.top10Finishes).toBe(1);
  });
});

describe("Ranked % and Avg Rank (scoring-board only)", () => {
  it("sums scoring-board selections over eligible ballots (not weekly averages)", () => {
    // Week 1: 2/4 scoring; Week 2: 1/6 scoring → 3/10 = 30% (not avg of 50%+16.7%)
    expect(rankedPctFromSums(2 + 1, 4 + 6)).toBe(0.3);
    expect(rankedPctFromSums(0, 10)).toBe(0);
    expect(rankedPctFromSums(0, 0)).toBeNull();
  });

  it("excludes reserve-only placements from Ranked % and Avg Rank", () => {
    const scoringDepth = scoringDepthForRankedMetric("RB", 10);
    const tally = tallyScoringBoardSelection({
      rankableEntryId: "p1",
      scoringDepth,
      eligibleBallots: [
        { picks: [{ rankableEntryId: "p1", predictedRank: 5 }] },
        { picks: [{ rankableEntryId: "p1", predictedRank: 11 }] }, // reserve
        { picks: [{ rankableEntryId: "other", predictedRank: 3 }] }, // unselected
        { picks: [] }, // unselected
      ],
    });

    expect(tally.eligibleBallotCount).toBe(4);
    expect(tally.scoringBoardSelections).toBe(1);
    expect(tally.scoringRankSum).toBe(5);
    expect(rankedPctFromSums(tally.scoringBoardSelections, tally.eligibleBallotCount)).toBe(
      0.25,
    );
    expect(
      avgRankedPositionFromSums(tally.scoringRankSum, tally.scoringBoardSelections),
    ).toBe(5);
  });

  it("Avg Rank excludes non-selections", () => {
    expect(avgRankedPositionFromSums(3 + 7, 2)).toBe(5);
    expect(avgRankedPositionFromSums(0, 0)).toBeNull();
  });

  it("aggregates Ranked % across weeks via summed counts", () => {
    const [row] = aggregatePlayerPerformance(
      [
        sourceRow({
          rankableEntryId: "p1",
          name: "Player",
          actualRank: 4,
          wasActive: true,
          scoringBoardSelections: 2,
          eligibleBallotCount: 4,
          scoringRankSum: 10,
        }),
        sourceRow({
          rankableEntryId: "p1",
          name: "Player",
          actualRank: 8,
          wasActive: true,
          weekId: "w2",
          weekNumber: 2,
          contestId: "c2",
          scoringBoardSelections: 1,
          eligibleBallotCount: 6,
          scoringRankSum: 4,
        }),
      ],
      { qualification: "ALL" },
    );

    expect(row.rankedPct).toBeCloseTo(0.3);
    expect(row.avgRankedPosition).toBeCloseTo(14 / 3);
    expect(row.scoringBoardSelections).toBe(3);
    expect(row.eligibleBallotCount).toBe(10);
  });
});

describe("Who's Hot week window", () => {
  it("uses only the last three finalized NFL weeks", () => {
    expect(lastCompletedFinalizedWeekNumbers([1, 2, 3, 4, 5], 3)).toEqual([
      3, 4, 5,
    ]);
  });

  it("handles fewer than three completed weeks", () => {
    expect(lastCompletedFinalizedWeekNumbers([1, 2], 3)).toEqual([1, 2]);
    expect(lastCompletedFinalizedWeekNumbers([], 3)).toEqual([]);
    expect(lastCompletedFinalizedWeekNumbers([4], 3)).toEqual([4]);
  });

  it("does not invent a current unfinished week", () => {
    // Only weeks that already appear in finalized contests are candidates.
    expect(lastCompletedFinalizedWeekNumbers([1, 2, 3], 3)).toEqual([1, 2, 3]);
  });
});

describe("Week view Top-40 and canonical ranks", () => {
  it("exposes a Top-40 limit beyond scoring depth", () => {
    expect(WEEK_LEADERBOARD_LIMIT).toBe(40);
    expect(WEEK_LEADERBOARD_LIMIT).toBeGreaterThan(15);
  });

  it("sorts week rows by actual finish without inventing missing ranks", () => {
    const rows: WeekPerformanceRow[] = [
      {
        rankableEntryId: "a",
        externalId: null,
        name: "A",
        team: "MIN",
        position: "RB",
        actualRank: 19,
        fantasyPoints: 8,
        rankedPct: 0.1,
        avgRankedPosition: 9,
        consensusRank: null,
        consensusSelectedPct: null,
        scoringBoardSelections: 1,
        eligibleBallotCount: 10,
      },
      {
        rankableEntryId: "b",
        externalId: null,
        name: "B",
        team: "GB",
        position: "RB",
        actualRank: 3,
        fantasyPoints: 20,
        rankedPct: 0.8,
        avgRankedPosition: 2,
        consensusRank: 1,
        consensusSelectedPct: 0.9,
        scoringBoardSelections: 8,
        eligibleBallotCount: 10,
      },
    ];

    const sorted = sortWeekPerformanceRows(rows, "actualRank", "asc");
    expect(sorted[0].actualRank).toBe(3);
    expect(sorted[1].actualRank).toBe(19);
  });
});

describe("mapContestEntriesToPerformanceSource", () => {
  it("marks inactive contest entries as non-scoring weeks", () => {
    const mapped = mapContestEntriesToPerformanceSource([
      {
        rankableEntryId: "p1",
        name: "Player",
        team: "MIN",
        position: "RB",
        weekId: "w1",
        weekLabel: "Week 1",
        weekNumber: 1,
        contestId: "c1",
        weekTeam: "MIN",
        actualRank: 99,
        fantasyPoints: 0,
        excluded: true,
        contestStatus: "FINAL",
      },
    ]);

    expect(mapped[0].wasActive).toBe(false);
    expect(mapped[0].contestFinal).toBe(true);
  });

  it("does not treat OPEN/LOCKED/GRADING as official", () => {
    for (const status of ["OPEN", "LOCKED", "GRADING"] as const) {
      const mapped = mapContestEntriesToPerformanceSource([
        {
          rankableEntryId: "p1",
          name: "Player",
          team: "MIN",
          position: "RB",
          weekId: "w1",
          weekLabel: "Week 1",
          weekNumber: 1,
          contestId: "c1",
          weekTeam: "MIN",
          actualRank: 1,
          fantasyPoints: 20,
          excluded: false,
          contestStatus: status,
        },
      ]);
      expect(mapped[0].contestFinal).toBe(false);
    }
  });

  it("does not create fake finishes for unselected / null ranks", () => {
    const rows = mapContestEntriesToPerformanceSource([
      {
        rankableEntryId: "p1",
        name: "Bench",
        team: "MIN",
        position: "RB",
        weekId: "w1",
        weekLabel: "Week 1",
        weekNumber: 1,
        contestId: "c1",
        weekTeam: "MIN",
        actualRank: null,
        fantasyPoints: null,
        excluded: false,
        contestStatus: "FINAL",
      },
    ]);
    const agg = aggregatePlayerPerformance(rows, { qualification: "ALL" });
    expect(agg).toHaveLength(0);
  });
});

describe("scope parsing and legacy sorting", () => {
  it("parses stable scope query params", () => {
    expect(parsePlayerPerformanceScope("season")).toBe("season");
    expect(parsePlayerPerformanceScope("hot")).toBe("hot");
    expect(parsePlayerPerformanceScope("week")).toBe("week");
    expect(parsePlayerPerformanceScope(undefined)).toBe("season");
  });

  it("shows qualification controls only for Season", () => {
    expect(shouldShowPlayerPerformanceQualificationControls("season")).toBe(
      true,
    );
    expect(shouldShowPlayerPerformanceQualificationControls("hot")).toBe(false);
    expect(shouldShowPlayerPerformanceQualificationControls("week")).toBe(
      false,
    );
  });

  it("Season honors ALL, MIN_4, and MIN_8 qualification filters", () => {
    const rows: PlayerPerformanceSourceRow[] = [
      sourceRow({
        rankableEntryId: "one-week",
        name: "One Week",
        actualRank: 2,
        wasActive: true,
        weekNumber: 1,
        weekId: "w1",
        contestId: "c1",
      }),
      ...[1, 2, 3, 4].map((weekNumber) =>
        sourceRow({
          rankableEntryId: "four-week",
          name: "Four Week",
          actualRank: weekNumber,
          wasActive: true,
          weekNumber,
          weekId: `w${weekNumber}`,
          contestId: `c${weekNumber}`,
        }),
      ),
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((weekNumber) =>
        sourceRow({
          rankableEntryId: "eight-week",
          name: "Eight Week",
          actualRank: weekNumber,
          wasActive: true,
          weekNumber,
          weekId: `w${weekNumber}`,
          contestId: `c${weekNumber}`,
        }),
      ),
    ];

    const all = aggregatePlayerPerformance(rows, { qualification: "ALL" });
    expect(all.map((row) => row.rankableEntryId).sort()).toEqual([
      "eight-week",
      "four-week",
      "one-week",
    ]);

    const min4 = aggregatePlayerPerformance(rows, { qualification: "MIN_4" });
    expect(min4.map((row) => row.rankableEntryId).sort()).toEqual([
      "eight-week",
      "four-week",
    ]);

    const min8 = aggregatePlayerPerformance(rows, { qualification: "MIN_8" });
    expect(min8.map((row) => row.rankableEntryId)).toEqual(["eight-week"]);
  });

  it("Who's Hot ignores stale MIN_4 / MIN_8 and keeps the available sample", () => {
    const hotWindowRows: PlayerPerformanceSourceRow[] = [
      sourceRow({
        rankableEntryId: "hot-only",
        name: "Hot Only",
        actualRank: 3,
        wasActive: true,
        weekNumber: 1,
        weekId: "w1",
        contestId: "c1",
      }),
    ];

    for (const stale of ["MIN_4", "MIN_8"] as const) {
      const effective = qualificationForPlayerPerformanceScope("hot", stale);
      expect(effective).toBe("ALL");
      const rows = aggregatePlayerPerformance(hotWindowRows, {
        qualification: effective,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.rankableEntryId).toBe("hot-only");
      expect(rows[0]!.weeksRecorded).toBe(1);
    }
  });

  it("Week scope ignores qualification parameters", () => {
    expect(qualificationForPlayerPerformanceScope("week", "MIN_4")).toBe("ALL");
    expect(qualificationForPlayerPerformanceScope("week", "MIN_8")).toBe("ALL");
    expect(qualificationForPlayerPerformanceScope("week", "ALL")).toBe("ALL");
    expect(qualificationForPlayerPerformanceScope("season", "MIN_4")).toBe(
      "MIN_4",
    );
  });

  it("preserves average-finish sort and player rows", () => {
    const rows: PlayerPerformanceSourceRow[] = [
      sourceRow({
        rankableEntryId: "jones",
        name: "Aaron Jones Sr.",
        actualRank: 7,
        wasActive: true,
      }),
      sourceRow({
        rankableEntryId: "jones",
        name: "Aaron Jones Sr.",
        actualRank: 3,
        wasActive: true,
        weekNumber: 2,
        weekId: "w2",
        contestId: "c2",
      }),
      sourceRow({
        rankableEntryId: "mason",
        name: "Jordan Mason",
        actualRank: 1,
        wasActive: true,
      }),
      sourceRow({
        rankableEntryId: "mason",
        name: "Jordan Mason",
        actualRank: 12,
        wasActive: true,
        weekNumber: 2,
        weekId: "w2",
        contestId: "c2",
      }),
    ];

    const leaderboard = aggregatePlayerPerformance(rows, {
      position: "RB",
      qualification: "ALL",
      sort: "averageFinish",
      sortDirection: "asc",
    });

    expect(leaderboard[0].name).toContain("Aaron");
    expect(leaderboard[1].name).toContain("Mason");
    expect(leaderboard[0].appearances).toHaveLength(2);
  });
});
