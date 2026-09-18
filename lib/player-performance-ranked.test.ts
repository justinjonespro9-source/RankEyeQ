import { describe, expect, it } from "vitest";
import {
  filterEligibleConsensusSubmissions,
  filterEligibleOfficialRankerSubmissions,
  isAllOfficialRankerIdentity,
} from "@/lib/consensus-filters";
import { EXPERT_SOURCE_KIND } from "@/lib/expert-identity";
import {
  avgRankedPositionFromSums,
  isScoringBoardRank,
  rankedPctFromSums,
  scoringDepthForRankedMetric,
  tallyScoringBoardSelection,
} from "@/lib/player-performance-ranked";

const pick = (id: string, rank = 1) => [
  { rankableEntryId: id, predictedRank: rank },
];

describe("player-performance-ranked helpers", () => {
  it("treats WR scoring depth as 15 by default", () => {
    expect(scoringDepthForRankedMetric("WR")).toBe(15);
    expect(scoringDepthForRankedMetric("RB")).toBe(10);
    expect(scoringDepthForRankedMetric("WR", 15)).toBe(15);
    expect(scoringDepthForRankedMetric("RB", 10)).toBe(10);
  });

  it("identifies scoring-board vs reserve ranks", () => {
    expect(isScoringBoardRank(10, 10)).toBe(true);
    expect(isScoringBoardRank(11, 10)).toBe(false);
    expect(isScoringBoardRank(15, 15)).toBe(true);
    expect(isScoringBoardRank(16, 15)).toBe(false);
  });

  it("keeps unselected ballots in the Ranked % denominator", () => {
    const tally = tallyScoringBoardSelection({
      rankableEntryId: "target",
      scoringDepth: 10,
      eligibleBallots: [
        { picks: [{ rankableEntryId: "target", predictedRank: 2 }] },
        { picks: [{ rankableEntryId: "other", predictedRank: 1 }] },
        { picks: [{ rankableEntryId: "target", predictedRank: 12 }] },
      ],
    });
    expect(tally.eligibleBallotCount).toBe(3);
    expect(tally.scoringBoardSelections).toBe(1);
    expect(rankedPctFromSums(1, 3)).toBeCloseTo(1 / 3);
  });

  it("Avg Rank uses scoring selections only", () => {
    expect(avgRankedPositionFromSums(2 + 8, 2)).toBe(5);
    expect(avgRankedPositionFromSums(0, 0)).toBeNull();
  });
});

describe("All Official Rankers Ranked % denominator", () => {
  const week = {
    id: "w1",
    seasonId: "s1",
    weekNumber: 1,
    startsAt: new Date("2025-09-07T17:00:00.000Z"),
  };

  const officialBoards = [
    {
      id: "human",
      status: "SUBMITTED" as const,
      profileType: "HUMAN" as const,
      picks: pick("p1", 3),
      week,
    },
    {
      id: "creator",
      status: "LOCKED" as const,
      profileType: "CREATOR" as const,
      picks: pick("p1", 5),
      week,
    },
    {
      id: "expert",
      status: "LOCKED" as const,
      profileType: "BENCHMARK" as const,
      sourceKind: EXPERT_SOURCE_KIND.ANALYST,
      picks: pick("p1", 2),
      week,
    },
    {
      id: "publisher",
      status: "GRADED" as const,
      profileType: "BENCHMARK" as const,
      sourceKind: EXPERT_SOURCE_KIND.PUBLISHER_CONSENSUS,
      picks: pick("other", 1),
      week,
    },
    {
      id: "ai",
      status: "LOCKED" as const,
      profileType: "AI" as const,
      picks: pick("p1", 11), // reserve-only
      week,
    },
    {
      id: "draft",
      status: "DRAFT" as const,
      profileType: "HUMAN" as const,
      picks: pick("p1", 1),
      week,
    },
    {
      id: "private-creator",
      status: "LOCKED" as const,
      profileType: "CREATOR" as const,
      competitorActive: true,
      publicVisible: false,
      picks: pick("p1", 1),
      week,
    },
    {
      id: "empty-expert",
      status: "LOCKED" as const,
      profileType: "BENCHMARK" as const,
      sourceKind: EXPERT_SOURCE_KIND.ANALYST,
      picks: [] as { rankableEntryId: string; predictedRank: number }[],
      week,
    },
  ];

  it("includes Human, Creator, Expert, Publisher, and AI official boards", () => {
    const eligible = filterEligibleOfficialRankerSubmissions(officialBoards);
    expect(eligible.map((row) => row.id).sort()).toEqual([
      "ai",
      "creator",
      "expert",
      "human",
      "publisher",
    ]);
  });

  it("does not double-count Creators as Humans", () => {
    expect(isAllOfficialRankerIdentity({ profileType: "CREATOR" })).toBe(true);
    expect(isAllOfficialRankerIdentity({ profileType: "HUMAN" })).toBe(true);
    const eligible = filterEligibleOfficialRankerSubmissions(officialBoards);
    expect(eligible.filter((row) => row.id === "creator")).toHaveLength(1);
    expect(eligible.filter((row) => row.profileType === "CREATOR")).toHaveLength(
      1,
    );
  });

  it("counts Expert and Publisher boards once each (distinct sourceKinds)", () => {
    const eligible = filterEligibleOfficialRankerSubmissions(officialBoards);
    expect(eligible.filter((row) => row.id === "expert")).toHaveLength(1);
    expect(eligible.filter((row) => row.id === "publisher")).toHaveLength(1);
    expect(
      eligible.filter((row) => row.profileType === "BENCHMARK"),
    ).toHaveLength(2);
  });

  it("omits a source with no board for this contest/position from the denominator", () => {
    // Contests are position-scoped: only submitted RankingSubmissions are passed in.
    // An Expert who covers WR but not RB simply has no RB submission here.
    const rbContestBoards = officialBoards.filter((row) => row.id !== "expert");
    const eligible = filterEligibleOfficialRankerSubmissions(rbContestBoards);
    expect(eligible.some((row) => row.id === "expert")).toBe(false);
    expect(eligible).toHaveLength(4);
  });

  it("excludes drafts, empty shells, and private unofficial boards", () => {
    const eligible = filterEligibleOfficialRankerSubmissions(officialBoards);
    expect(eligible.some((row) => row.id === "draft")).toBe(false);
    expect(eligible.some((row) => row.id === "empty-expert")).toBe(false);
    expect(eligible.some((row) => row.id === "private-creator")).toBe(false);
  });

  it("leaves consensus ballot_union ALL as Human+AI only", () => {
    const consensusAll = filterEligibleConsensusSubmissions(
      officialBoards,
      "ALL",
    );
    expect(consensusAll.map((row) => row.id).sort()).toEqual(["ai", "human"]);
  });

  it("tallies Ranked % with reserves excluded and non-selections in denominator", () => {
    const eligible = filterEligibleOfficialRankerSubmissions(officialBoards);
    const tally = tallyScoringBoardSelection({
      rankableEntryId: "p1",
      scoringDepth: 10,
      eligibleBallots: eligible,
    });
    // human(3), creator(5), expert(2) score; publisher unselected; ai reserve-only
    expect(tally.eligibleBallotCount).toBe(5);
    expect(tally.scoringBoardSelections).toBe(3);
    expect(tally.scoringRankSum).toBe(3 + 5 + 2);
    expect(
      rankedPctFromSums(
        tally.scoringBoardSelections,
        tally.eligibleBallotCount,
      ),
    ).toBeCloseTo(0.6);
    expect(
      avgRankedPositionFromSums(
        tally.scoringRankSum,
        tally.scoringBoardSelections,
      ),
    ).toBeCloseTo(10 / 3);
  });

  it("aggregates across weeks by summing counts", () => {
    expect(rankedPctFromSums(3 + 1, 5 + 5)).toBeCloseTo(0.4);
  });
});
