import type { ConsensusEntry } from "@/lib/consensus-math";
import type { ConsensusAllMode } from "@/lib/consensus-config";

export type SegmentConsensusBundle = {
  entries: ConsensusEntry[];
  sampleSize: number;
};

/**
 * Equal-weight merge of Human / AI / Expert segment consensus outputs.
 * Does not fabricate Expert values when that segment has zero ballots.
 */
export function buildGroupWeightedAllConsensus(input: {
  fieldSize: number;
  human: SegmentConsensusBundle;
  ai: SegmentConsensusBundle;
  expert: SegmentConsensusBundle;
  actualResultFinal?: boolean;
}): {
  entries: ConsensusEntry[];
  sampleSize: number;
  groupsRepresented: number;
} {
  const segments = [
    { key: "human" as const, bundle: input.human },
    { key: "ai" as const, bundle: input.ai },
    { key: "expert" as const, bundle: input.expert },
  ].filter((segment) => segment.bundle.sampleSize > 0);

  const byPlayer = new Map<
    string,
    {
      base: ConsensusEntry;
      selectionRates: number[];
      averageRanks: number[];
    }
  >();

  for (const segment of segments) {
    for (const entry of segment.bundle.entries) {
      const existing = byPlayer.get(entry.rankableEntryId);
      if (!existing) {
        byPlayer.set(entry.rankableEntryId, {
          base: { ...entry },
          selectionRates: [entry.selectionRate],
          averageRanks:
            entry.averageSelectedRank != null ? [entry.averageSelectedRank] : [],
        });
        continue;
      }
      existing.selectionRates.push(entry.selectionRate);
      if (entry.averageSelectedRank != null) {
        existing.averageRanks.push(entry.averageSelectedRank);
      }
    }
  }

  const merged: ConsensusEntry[] = [];

  for (const { base, selectionRates, averageRanks } of byPlayer.values()) {
    const selectionRate =
      selectionRates.length === 0
        ? 0
        : selectionRates.reduce((sum, value) => sum + value, 0) /
          selectionRates.length;
    const averageSelectedRank =
      averageRanks.length === 0
        ? null
        : averageRanks.reduce((sum, value) => sum + value, 0) /
          averageRanks.length;

    merged.push({
      ...base,
      actualResultFinal: input.actualResultFinal ?? base.actualResultFinal,
      selectionRate,
      rankPercent: selectionRate,
      averageSelectedRank,
      averagePredictedRank: averageSelectedRank,
      consensusRank: null,
      sampleSize: segments.length,
      timesRanked: Math.round(selectionRate * segments.length),
      percentRankedTopN: selectionRate,
      percentRankedTop3: 0,
      percentRankedOne: 0,
      podiumPercent: 0,
      rankPercentRank: null,
      podiumPercentRank: null,
      averageRankRank: null,
      rankStdev: null,
      consensusVsActual: null,
    });
  }

  const ranked = merged
    .filter((entry) => entry.averageSelectedRank != null)
    .sort((a, b) => {
      const diff =
        (a.averageSelectedRank ?? 999) - (b.averageSelectedRank ?? 999);
      if (diff !== 0) return diff;
      return b.selectionRate - a.selectionRate;
    });

  ranked.forEach((entry, index) => {
    entry.consensusRank = index + 1;
    if (entry.actualRank != null) {
      entry.consensusVsActual = entry.actualRank - (entry.consensusRank as number);
    }
  });

  const neverRanked = merged.filter((entry) => entry.averageSelectedRank == null);

  return {
    entries: [...ranked, ...neverRanked],
    sampleSize: segments.length,
    groupsRepresented: segments.length,
  };
}

export function consensusAllModeLabel(mode: ConsensusAllMode): string {
  return mode === "ballot_union" ? "Ballot union (Human + AI)" : "Group weighted (Human · Expert · AI)";
}
