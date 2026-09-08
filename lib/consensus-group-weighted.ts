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
   * Mirrors totalEntryCount so callers treating sampleSize as “how many boards”
   * are not shown a group count.
   */
  sampleSize: number;
  /** Alias of contributingGroupCount. */
  groupsRepresented: number;
};

/**
 * Recover an integer selected-count from rate × sample when exact counts are missing.
 * Never returns 0 when rate > 0 and sampleSize > 0 (avoids Selected % > 0 with Ballots 0).
 */
export function selectedCountFromRate(
  selectionRate: number,
  sampleSize: number,
): number {
  if (selectionRate <= 0 || sampleSize <= 0) return 0;
  return Math.max(1, Math.round(selectionRate * sampleSize));
}

/**
 * Equal-weight merge of Human / Experts / Creators / AI segment consensus outputs.
 * Empty groups are skipped — never fabricated.
 *
 * Selected % / Avg Selected Rank = equal-weight across non-empty groups.
 * BALLOTS (timesRanked) = sum of raw individual selection counts across those groups.
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

  const bySegmentEntries = segments.map((segment) => ({
    key: segment.key,
    sampleSize: segment.bundle.sampleSize,
    byId: new Map(
      segment.bundle.entries.map((entry) => [entry.rankableEntryId, entry]),
    ),
  }));

  const playerIds = new Set<string>();
  for (const segment of bySegmentEntries) {
    for (const id of segment.byId.keys()) playerIds.add(id);
  }

  const merged: ConsensusEntry[] = [];

  for (const playerId of playerIds) {
    const selectionRates: number[] = [];
    const averageRanks: number[] = [];
    let selectedCountHuman = 0;
    let selectedCountExpert = 0;
    let selectedCountCreator = 0;
    let selectedCountAi = 0;
    let base: ConsensusEntry | null = null;

    for (const segment of bySegmentEntries) {
      const entry = segment.byId.get(playerId);
      const selectionRate = entry?.selectionRate ?? 0;
      const timesRanked = entry?.timesRanked ?? 0;
      selectionRates.push(selectionRate);
      if (entry?.averageSelectedRank != null) {
        averageRanks.push(entry.averageSelectedRank);
      }
      if (segment.key === "human") selectedCountHuman = timesRanked;
      if (segment.key === "expert") selectedCountExpert = timesRanked;
      if (segment.key === "creator") selectedCountCreator = timesRanked;
      if (segment.key === "ai") selectedCountAi = timesRanked;
      if (entry && !base) base = entry;
    }

    if (!base) continue;

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

    const totalBallotCount =
      selectedCountHuman +
      selectedCountExpert +
      selectedCountCreator +
      selectedCountAi;
    const timesRanked =
      selectionRate > 0 && totalBallotCount === 0 ? 1 : totalBallotCount;

    merged.push({
      ...base,
      actualResultFinal: input.actualResultFinal ?? base.actualResultFinal,
      selectionRate,
      rankPercent: selectionRate,
      averageSelectedRank,
      averagePredictedRank: averageSelectedRank,
      consensusRank: null,
      sampleSize: totalEntryCount,
      timesRanked,
      selectedCountHuman,
      selectedCountExpert,
      selectedCountCreator,
      selectedCountAi,
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
 * total entry count. Prefer segment sample columns when present.
 */
export function resolveAllParticipationFromSnapshot(snapshot: {
  sampleSizeAll: number;
  sampleSizeHuman: number;
  sampleSizeAi: number;
  sampleSizeExpert: number;
  sampleSizeCreator?: number;
  allConsensusMode?: string | null;
}): {
  totalEntryCount: number;
  contributingGroupCount: number;
} {
  const human = snapshot.sampleSizeHuman;
  const ai = snapshot.sampleSizeAi;
  const expert = snapshot.sampleSizeExpert;
  const creator = snapshot.sampleSizeCreator ?? 0;
  const segmentTotal = human + ai + expert + creator;
  const segmentGroups = [human, ai, expert, creator].filter(
    (count) => count > 0,
  ).length;
  const stored = snapshot.sampleSizeAll;
  const mode = snapshot.allConsensusMode ?? "group_weighted";

  if (mode === "ballot_union") {
    return {
      totalEntryCount: stored || human + ai,
      contributingGroupCount: Math.max(
        [human, ai].filter((count) => count > 0).length,
        stored > 0 ? 1 : 0,
      ),
    };
  }

  if (segmentTotal > 0) {
    // Prefer explicit segment samples (including Creator when stored).
    if (stored === 0 || stored === segmentTotal || stored === segmentGroups) {
      return {
        totalEntryCount: segmentTotal,
        contributingGroupCount: segmentGroups,
      };
    }
  }

  // Historical group_weighted: sampleSizeAll was contributingGroupCount (≤4).
  const legacySegmentTotal = human + ai + expert;
  const legacySegmentGroups = [human, ai, expert].filter(
    (count) => count > 0,
  ).length;
  const looksLikeStoredGroupCount =
    stored > 0 &&
    stored <= 4 &&
    legacySegmentTotal > stored &&
    stored >= legacySegmentGroups &&
    stored <= legacySegmentGroups + 1;

  if (looksLikeStoredGroupCount) {
    const impliedCreatorEntries = Math.max(0, stored === legacySegmentGroups + 1 ? 0 : 0);
    // When stored groups exceed H+A+E columns, treat extra as Creator ballots unknown;
    // total still uses legacy segment sum (safest without Creator sample column).
    void impliedCreatorEntries;
    return {
      totalEntryCount: legacySegmentTotal,
      contributingGroupCount: stored,
    };
  }

  const impliedCreatorEntries = Math.max(0, stored - legacySegmentTotal);
  const contributingGroupCount =
    legacySegmentGroups + (impliedCreatorEntries > 0 || creator > 0 ? 1 : 0);

  return {
    totalEntryCount: stored > 0 ? stored : segmentTotal || legacySegmentTotal,
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
