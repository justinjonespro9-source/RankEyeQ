import { describe, expect, it } from "vitest";
import { buildGroupWeightedAllConsensus } from "@/lib/consensus-group-weighted";
import { filterEligibleConsensusSubmissions } from "@/lib/consensus-filters";
import {
  BENCHMARK_SCORING_FORMAT,
  EXPERT_SOURCE_KIND,
  formatBenchmarkScoringDisclosure,
  formatExpertAffiliationBadge,
  isAnalystExpertSource,
  isPublisherConsensusSource,
} from "@/lib/expert-identity";
import { competitorIdentityChip } from "@/lib/profile-labels";
import type { ConsensusEntry } from "@/lib/consensus-math";

function entry(
  id: string,
  selectionRate: number,
  timesRanked: number,
): ConsensusEntry {
  return {
    rankableEntryId: id,
    name: id,
    team: "MIN",
    opponent: "vs GB",
    actualRank: null,
    fantasyPoints: null,
    actualResultFinal: false,
    averagePredictedRank: 1,
    averageSelectedRank: 1,
    consensusRank: 1,
    percentRankedOne: 0,
    percentRankedTop3: 0,
    percentRankedTopN: selectionRate,
    rankPercent: selectionRate,
    selectionRate,
    rankPercentRank: null,
    podiumPercent: 0,
    podiumPercentRank: null,
    averageRankRank: null,
    timesRanked,
    sampleSize: 10,
    rankStdev: null,
    consensusVsActual: null,
  };
}

describe("Publisher Consensus class", () => {
  it("keeps individual Experts as ANALYST and Publisher Consensus distinct", () => {
    expect(isAnalystExpertSource(EXPERT_SOURCE_KIND.ANALYST)).toBe(true);
    expect(isPublisherConsensusSource(EXPERT_SOURCE_KIND.ANALYST)).toBe(false);
    expect(
      isPublisherConsensusSource(EXPERT_SOURCE_KIND.PUBLISHER_CONSENSUS),
    ).toBe(true);
    expect(isAnalystExpertSource(EXPERT_SOURCE_KIND.PUBLISHER_CONSENSUS)).toBe(
      false,
    );
    expect(isPublisherConsensusSource(EXPERT_SOURCE_KIND.PUBLISHER)).toBe(false);
  });

  it("filters Expert vs Publisher Consensus by sourceKind", () => {
    const ballots = [
      {
        id: "analyst",
        status: "LOCKED" as const,
        profileType: "BENCHMARK" as const,
        sourceKind: EXPERT_SOURCE_KIND.ANALYST,
        picks: [{ id: "1" }],
      },
      {
        id: "publisher",
        status: "LOCKED" as const,
        profileType: "BENCHMARK" as const,
        sourceKind: EXPERT_SOURCE_KIND.PUBLISHER_CONSENSUS,
        picks: [{ id: "1" }],
      },
      {
        id: "shell",
        status: "LOCKED" as const,
        profileType: "BENCHMARK" as const,
        sourceKind: EXPERT_SOURCE_KIND.PUBLISHER,
        picks: [{ id: "1" }],
      },
    ];

    expect(
      filterEligibleConsensusSubmissions(ballots, "EXPERT").map((row) => row.id),
    ).toEqual(["analyst"]);
    expect(
      filterEligibleConsensusSubmissions(ballots, "PUBLISHER").map(
        (row) => row.id,
      ),
    ).toEqual(["publisher"]);
  });

  it("does not let Publisher Consensus affect All group-weighted blend", () => {
    const human = {
      sampleSize: 1,
      entries: [entry("x", 1, 1)],
    };
    const expert = {
      sampleSize: 1,
      entries: [entry("x", 0.5, 1)],
    };
    const withoutPublisher = buildGroupWeightedAllConsensus({
      fieldSize: 10,
      human,
      expert,
      ai: { sampleSize: 0, entries: [] },
      creator: { sampleSize: 0, entries: [] },
    });

    // Publisher Consensus is never passed into All — only the four groups.
    expect(withoutPublisher.contributingGroupCount).toBe(2);
    expect(withoutPublisher.totalEntryCount).toBe(2);
    expect(
      withoutPublisher.entries.find((row) => row.rankableEntryId === "x")
        ?.selectionRate,
    ).toBeCloseTo(0.75);
  });

  it("uses CONSENSUS · publisher identity chips", () => {
    expect(
      formatExpertAffiliationBadge({
        displayName: "Yahoo Fantasy Consensus",
        publicationName: "Yahoo",
        sourceKind: EXPERT_SOURCE_KIND.PUBLISHER_CONSENSUS,
      }),
    ).toBe("CONSENSUS · Yahoo");

    expect(
      competitorIdentityChip({
        profileType: "BENCHMARK",
        expertPublisher: "ESPN",
        expertSourceKind: EXPERT_SOURCE_KIND.PUBLISHER_CONSENSUS,
      }).label,
    ).toBe("CONSENSUS · ESPN");

    expect(
      competitorIdentityChip({
        profileType: "BENCHMARK",
        expertPublisher: "Yahoo Fantasy",
        expertSourceKind: EXPERT_SOURCE_KIND.ANALYST,
      }).label,
    ).toBe("EXPERT · Yahoo Fantasy");
  });

  it("formats scoring-format disclosure", () => {
    expect(
      formatBenchmarkScoringDisclosure({
        scoringFormat: BENCHMARK_SCORING_FORMAT.HALF_PPR,
      }),
    ).toContain("Half PPR");
    expect(
      formatBenchmarkScoringDisclosure({
        scoringFormat: BENCHMARK_SCORING_FORMAT.UNSPECIFIED,
      }),
    ).toContain("Original source scoring assumptions may differ");
  });
});
