import type { ConsensusEntry } from "@/lib/consensus-math";
import type { ConsensusAllMode } from "@/lib/consensus-config";

export type SegmentConsensusBundle = {
  entries: ConsensusEntry[];
  sampleSize: number;
};

export type GroupWeightedAllConsensus = {
  entries: ConsensusEntry[];
  /** Sum of qualifying ballots across non-empty groups (display / participation). */
  totalEntryCount: number;
  /** Number of non-empty groups used in equal-weight All. */
  contributingGroupCount: number;
  /**
   * @deprecated Prefer totalEntryCount / contributingGroupCount.
   * Kept as totalEntryCount so callers treating sampleSize as “how many boards”
   * are not shown a group count.
   */
  sampleSize: number;
  /** Alias of contributingGroupCount. */
  groupsRepresented: number;
};

/**
 * Equal-weight merge of Human / Experts / Creators / AI segment consensus outputs.
 * Empty groups are skipped — never fabricated.
 *
 * Weighting is by group, not by ballot count. Participation metadata is separate:
 * totalEntryCount vs contributingGroupCount.
 */
export function buildGroupWeightedAllConsensus(input: {
  fieldSize: number;
  human: SegmentConsensusBundle;
  ai: SegmentConsensusBundle;
  expert: SegmentConsensusBundle;
  /** Optional for backward-compatible callers; omitted/empty is skipped. */
  creator?: SegmentConsensusBundle;
  actualResultFinal?: boolean;
}): GroupWeightedAllConsensus {
  const creator = input.creator ?? { sampleSize: 0, entries: [] };
  const segments = [
    { key: "human" as const, bundle: input.human },
    { key: "expert" as const, bundle: input.expert },
    { key: "creator" as const, bundle: creator },
    { key: "ai" as const, bundle: input.ai },
  ].filter((segment) => segment.bundle.sampleSize > 0);

  const contributingGroupCount = segments.length;
  const totalEntryCount = segments.reduce(
    (sum, segment) => sum + segment.bundle.sampleSize,
    0,
  );

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
      // Per-entry sampleSize stays group-scoped for timesRanked display only;
      // it does not change equal-weight Selected % / Avg Rank math above.
      sampleSize: contributingGroupCount,
      timesRanked: Math.round(selectionRate * contributingGroupCount),
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
    totalEntryCount,
    contributingGroupCount,
    sampleSize: totalEntryCount,
    groupsRepresented: contributingGroupCount,
  };
}

/**
 * Resolve All participation counts from a pregame snapshot.
 * Historical snapshots stored group count in sampleSizeAll; newer ones may store
 * total entry count. Segment columns always hold per-class ballot counts
 * (Creator not stored yet — inferred when sampleSizeAll exceeds segment sum).
 */
export function resolveAllParticipationFromSnapshot(snapshot: {
  sampleSizeAll: number;
  sampleSizeHuman: number;
  sampleSizeAi: number;
  sampleSizeExpert: number;
  allConsensusMode?: string | null;
}): {
  totalEntryCount: number;
  contributingGroupCount: number;
} {
  const human = snapshot.sampleSizeHuman;
  const ai = snapshot.sampleSizeAi;
  const expert = snapshot.sampleSizeExpert;
  const segmentTotal = human + ai + expert;
  const segmentGroups = [human, ai, expert].filter((count) => count > 0).length;
  const stored = snapshot.sampleSizeAll;
  const mode = snapshot.allConsensusMode ?? "group_weighted";

  if (mode === "ballot_union") {
    return {
      totalEntryCount: stored || segmentTotal,
      contributingGroupCount: Math.max(segmentGroups, stored > 0 ? 1 : 0),
    };
  }

  // Historical group_weighted: sampleSizeAll was contributingGroupCount (≤4).
  const looksLikeStoredGroupCount =
    stored > 0 &&
    stored <= 4 &&
    segmentTotal > stored &&
    stored >= segmentGroups &&
    stored <= segmentGroups + 1;

  if (looksLikeStoredGroupCount) {
    return {
      totalEntryCount: segmentTotal,
      contributingGroupCount: stored,
    };
  }

  const impliedCreatorEntries = Math.max(0, stored - segmentTotal);
  const contributingGroupCount =
    segmentGroups + (impliedCreatorEntries > 0 ? 1 : 0);

  return {
    totalEntryCount: stored > 0 ? stored : segmentTotal,
    contributingGroupCount:
      contributingGroupCount > 0 ? contributingGroupCount : stored,
  };
}

export function consensusAllModeLabel(mode: ConsensusAllMode): string {
  return mode === "ballot_union"
    ? "Ballot union (Human + AI)"
    : "Group weighted (Human · Experts · Creators · AI)";
}

export function formatConsensusParticipationBadge(input: {
  filter: string;
  sampleSize: number;
  totalEntryCount?: number;
  contributingGroupCount?: number;
}): string {
  if (input.filter === "ALL") {
    const entries = input.totalEntryCount ?? input.sampleSize;
    const groups = input.contributingGroupCount;
    if (groups != null && groups > 0) {
      return `${entries} ${entries === 1 ? "entry" : "entries"} · ${groups} ${
        groups === 1 ? "group" : "groups"
      }`;
    }
    return `${entries} ${entries === 1 ? "entry" : "entries"}`;
  }
  const n = input.sampleSize;
  return `${n} ${n === 1 ? "entry" : "entries"}`;
}
