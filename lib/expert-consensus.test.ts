import { describe, expect, it } from "vitest";
import {
  buildGroupWeightedAllConsensus,
  formatConsensusParticipationBadge,
  resolveAllParticipationFromSnapshot,
} from "@/lib/consensus-group-weighted";
import {
  describeConsensusAllMode,
  getConsensusAllMode,
} from "@/lib/consensus-config";
import type { ConsensusEntry } from "@/lib/consensus-math";
import { isExpertProfile } from "@/lib/expert-identity";

function entry(
  id: string,
  name: string,
  consensusRank: number,
  selectionRate: number,
  averageSelectedRank: number,
): ConsensusEntry {
  return {
    rankableEntryId: id,
    name,
    team: "MIN",
    opponent: "vs GB",
    actualRank: null,
    fantasyPoints: null,
    actualResultFinal: false,
    averagePredictedRank: averageSelectedRank,
    averageSelectedRank,
    consensusRank,
    percentRankedOne: 0,
    percentRankedTop3: 0,
    percentRankedTopN: selectionRate,
    rankPercent: selectionRate,
    selectionRate,
    rankPercentRank: null,
    podiumPercent: 0,
    podiumPercentRank: null,
    averageRankRank: null,
    timesRanked: Math.round(selectionRate * 10),
    sampleSize: 10,
    rankStdev: null,
    consensusVsActual: null,
  };
}

describe("consensus ALL weighting", () => {
  it("documents group_weighted All as four equal groups including Creators", () => {
    expect(describeConsensusAllMode("group_weighted")).toContain("Creators");
    expect(describeConsensusAllMode("group_weighted")).toContain("Human");
    expect(describeConsensusAllMode("group_weighted")).toContain("Experts");
    expect(describeConsensusAllMode("group_weighted")).toContain("AI");
  });

  it("documents legacy ballot_union as Human+AI only", () => {
    expect(describeConsensusAllMode("ballot_union")).toContain("Human and AI");
    expect(describeConsensusAllMode("ballot_union")).toContain("Expert");
  });

  it("defaults to group_weighted mode", () => {
    expect(getConsensusAllMode()).toBe("group_weighted");
  });

  it("averages segment Selected % equally (not by ballot population)", () => {
    const human = {
      sampleSize: 10_000,
      entries: [entry("x", "Player X", 1, 0.9, 3)],
    };
    const expert = {
      sampleSize: 10,
      entries: [entry("x", "Player X", 1, 0.75, 4)],
    };
    const ai = {
      sampleSize: 5,
      entries: [entry("x", "Player X", 1, 0.4, 5)],
    };

    const merged = buildGroupWeightedAllConsensus({
      fieldSize: 10,
      human,
      expert,
      ai,
    });

    const playerX = merged.entries.find((row) => row.rankableEntryId === "x");
    expect(playerX?.selectionRate).toBeCloseTo(0.68333, 4);
    expect(playerX?.averageSelectedRank).toBeCloseTo(4, 5);
    expect(merged.groupsRepresented).toBe(3);
    expect(merged.contributingGroupCount).toBe(3);
    expect(merged.totalEntryCount).toBe(10_000 + 10 + 5);
    expect(merged.sampleSize).toBe(10_000 + 10 + 5);
  });

  it("includes Creators as a fourth equal group when present", () => {
    const human = {
      sampleSize: 100,
      entries: [entry("x", "Player X", 1, 1, 1)],
    };
    const expert = {
      sampleSize: 10,
      entries: [entry("x", "Player X", 1, 0.8, 2)],
    };
    const creator = {
      sampleSize: 4,
      entries: [entry("x", "Player X", 1, 0.6, 3)],
    };
    const ai = {
      sampleSize: 2,
      entries: [entry("x", "Player X", 1, 0.4, 4)],
    };

    const merged = buildGroupWeightedAllConsensus({
      fieldSize: 10,
      human,
      expert,
      creator,
      ai,
    });

    const playerX = merged.entries.find((row) => row.rankableEntryId === "x");
    expect(playerX?.selectionRate).toBeCloseTo(0.7, 5);
    expect(playerX?.averageSelectedRank).toBeCloseTo(2.5, 5);
    expect(merged.groupsRepresented).toBe(4);
    expect(merged.contributingGroupCount).toBe(4);
    expect(merged.totalEntryCount).toBe(116);
    expect(merged.sampleSize).toBe(116);
  });

  it("reports production-style All participation without changing group weights", () => {
    const human = {
      sampleSize: 1,
      entries: [entry("x", "Player X", 1, 1, 2)],
    };
    const expert = {
      sampleSize: 3,
      entries: [entry("x", "Player X", 1, 0.9, 3)],
    };
    const creator = {
      sampleSize: 1,
      entries: [entry("x", "Player X", 1, 0.8, 4)],
    };
    const ai = {
      sampleSize: 8,
      entries: [entry("x", "Player X", 1, 0.5, 5)],
    };

    const merged = buildGroupWeightedAllConsensus({
      fieldSize: 10,
      human,
      expert,
      creator,
      ai,
    });

    expect(merged.totalEntryCount).toBe(13);
    expect(merged.contributingGroupCount).toBe(4);
    expect(merged.sampleSize).toBe(13);
    // Equal group weight: AI's 8 ballots do not dominate the 1 Human ballot.
    expect(
      merged.entries.find((row) => row.rankableEntryId === "x")?.selectionRate,
    ).toBeCloseTo((1 + 0.9 + 0.8 + 0.5) / 4, 5);
  });

  it("builds group-weighted All without fabricating Expert when empty", () => {
    const human = {
      sampleSize: 100,
      entries: [entry("a", "Player A", 1, 0.8, 2)],
    };
    const ai = {
      sampleSize: 5,
      entries: [entry("a", "Player A", 1, 1, 1)],
    };
    const expert = { sampleSize: 0, entries: [] as ConsensusEntry[] };

    const merged = buildGroupWeightedAllConsensus({
      fieldSize: 10,
      human,
      ai,
      expert,
    });

    expect(merged.groupsRepresented).toBe(2);
    expect(merged.contributingGroupCount).toBe(2);
    expect(merged.totalEntryCount).toBe(105);
    expect(merged.sampleSize).toBe(105);
    const playerA = merged.entries.find((row) => row.rankableEntryId === "a");
    expect(playerA?.selectionRate).toBeCloseTo(0.9);
  });

  it("isolates Expert segment from Human ballots", () => {
    const human = {
      sampleSize: 2,
      entries: [entry("a", "A", 1, 1, 1), entry("b", "B", 2, 0.5, 5)],
    };
    const expert = {
      sampleSize: 1,
      entries: [entry("a", "A", 2, 1, 8)],
    };

    const humanOnly = buildGroupWeightedAllConsensus({
      fieldSize: 10,
      human,
      ai: { sampleSize: 0, entries: [] },
      expert: { sampleSize: 0, entries: [] },
    });
    const withExpert = buildGroupWeightedAllConsensus({
      fieldSize: 10,
      human,
      ai: { sampleSize: 0, entries: [] },
      expert,
    });

    const humanA = humanOnly.entries.find((row) => row.rankableEntryId === "a");
    const blendA = withExpert.entries.find((row) => row.rankableEntryId === "a");
    expect(humanA?.averageSelectedRank).toBe(1);
    expect(blendA?.averageSelectedRank).toBe(4.5);
  });
});

describe("All participation display counts", () => {
  it("formats All as entries · groups and segments as entries", () => {
    expect(
      formatConsensusParticipationBadge({
        filter: "ALL",
        sampleSize: 13,
        totalEntryCount: 13,
        contributingGroupCount: 4,
      }),
    ).toBe("13 entries · 4 groups");
    expect(
      formatConsensusParticipationBadge({
        filter: "AI",
        sampleSize: 8,
      }),
    ).toBe("8 entries");
    expect(
      formatConsensusParticipationBadge({
        filter: "HUMAN",
        sampleSize: 1,
      }),
    ).toBe("1 entry");
  });

  it("derives totals from historical snapshot group counts", () => {
    const historical = resolveAllParticipationFromSnapshot({
      sampleSizeAll: 3,
      sampleSizeHuman: 5,
      sampleSizeAi: 2,
      sampleSizeExpert: 2,
      allConsensusMode: "group_weighted",
    });
    expect(historical.totalEntryCount).toBe(9);
    expect(historical.contributingGroupCount).toBe(3);

    const withCreatorTotal = resolveAllParticipationFromSnapshot({
      sampleSizeAll: 13,
      sampleSizeHuman: 1,
      sampleSizeAi: 8,
      sampleSizeExpert: 3,
      allConsensusMode: "group_weighted",
    });
    expect(withCreatorTotal.totalEntryCount).toBe(13);
    expect(withCreatorTotal.contributingGroupCount).toBe(4);
  });
});

describe("expert identity", () => {
  it("treats BENCHMARK profiles as experts", () => {
    expect(isExpertProfile("BENCHMARK")).toBe(true);
    expect(isExpertProfile("HUMAN")).toBe(false);
    expect(isExpertProfile("AI")).toBe(false);
  });
});

describe("expert import parsing", () => {
  it("parses numbered CSV-style expert paste", async () => {
    const { extractTopNFromPastedText } = await import("@/lib/benchmarks/parser");
    const eligible = [
      {
        id: "p1",
        name: "Player Alpha",
        shortName: "Alpha",
        team: "MIN",
        position: "RB" as const,
      },
      {
        id: "p2",
        name: "Player Beta",
        shortName: "Beta",
        team: "GB",
        position: "RB" as const,
      },
    ];
    const result = extractTopNFromPastedText({
      text: "1. Player Alpha\n2. Player Beta",
      eligible,
      rankingDepth: 2,
    });
    expect(result.ready).toBe(true);
    expect(result.selected).toHaveLength(2);
    expect(result.selected[0]?.matchedEntryId).toBe("p1");
  });
});
