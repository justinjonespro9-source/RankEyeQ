import {
  assignCompetitionRanks,
  assignCompetitionRanksAscending,
} from "@/lib/fantasy/competition-rank";

export type ConsensusEntry = {
  rankableEntryId: string;
  name: string;
  team: string;
  opponent: string;
  actualRank: number | null;
  fantasyPoints: number | null;
  /** True when contest is FINAL/ARCHIVED and actualRank is authoritative. */
  actualResultFinal: boolean;
  averagePredictedRank: number | null;
  consensusRank: number | null;
  percentRankedOne: number;
  percentRankedTop3: number;
  percentRankedTopN: number;
  /** Rank % — share of eligible boards that include this player. */
  rankPercent: number;
  /** Selected % — share of submitted ballots that ranked this player (any slot). */
  selectionRate: number;
  /** Avg rank among ballots that included this player (omitted ballots excluded). */
  averageSelectedRank: number | null;
  /** Ordinal rank for Rank % within this week/position/filter (higher % = better). */
  rankPercentRank: number | null;
  /** Podium % — share of eligible boards with this player in slots 1–3. */
  podiumPercent: number;
  /** Ordinal rank for Podium % within this week/position/filter. */
  podiumPercentRank: number | null;
  /** Ordinal rank for average placement among boards that include this player. */
  averageRankRank: number | null;
  timesRanked: number;
  /** Eligible submitted boards in this filter context. */
  sampleSize: number;
  /** Population stdev of predicted ranks among ballots that included the player. */
  rankStdev: number | null;
  consensusVsActual: number | null;
};

/** Reusable weekly player-confidence signals for comparison UIs. */
export type PlayerConfidenceSignals = Pick<
  ConsensusEntry,
  | "rankableEntryId"
  | "name"
  | "rankPercent"
  | "rankPercentRank"
  | "podiumPercent"
  | "podiumPercentRank"
  | "averagePredictedRank"
  | "averageRankRank"
  | "sampleSize"
  | "actualRank"
  | "fantasyPoints"
  | "actualResultFinal"
>;

export type ConsensusCallouts = {
  biggestHit: ConsensusEntry | null;
  biggestMiss: ConsensusEntry | null;
  mostPolarizing: ConsensusEntry | null;
};

function stdev(values: number[]) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function applyOrdinalRanks(entries: ConsensusEntry[]) {
  const rankPercentRanked = assignCompetitionRanks(
    entries,
    (entry) => entry.rankPercent,
  );
  for (const row of rankPercentRanked) {
    row.item.rankPercentRank = row.rank;
  }

  const podiumPercentRanked = assignCompetitionRanks(
    entries,
    (entry) => entry.podiumPercent,
  );
  for (const row of podiumPercentRanked) {
    row.item.podiumPercentRank = row.rank;
  }

  const averageRankPool = entries.filter(
    (entry) => entry.averagePredictedRank != null && entry.timesRanked > 0,
  );
  const averageRankRanked = assignCompetitionRanksAscending(
    averageRankPool,
    (entry) => entry.averagePredictedRank as number,
  );
  for (const row of averageRankRanked) {
    row.item.averageRankRank = row.rank;
  }
}

/**
 * Pure consensus builder — drafts must be filtered out before calling.
 */
export function buildConsensusEntries(input: {
  fieldSize: number;
  sampleSize: number;
  actualResultFinal?: boolean;
  entries: {
    rankableEntryId: string;
    name: string;
    team: string;
    opponent: string;
    actualRank: number | null;
    fantasyPoints: number | null;
    predictedRanks: number[];
  }[];
}): { entries: ConsensusEntry[]; callouts: ConsensusCallouts } {
  const actualResultFinal = input.actualResultFinal ?? false;

  const withStats: ConsensusEntry[] = input.entries.map((entry) => {
    const ranks = entry.predictedRanks;
    const timesRanked = ranks.length;
    const averagePredictedRank =
      timesRanked === 0
        ? null
        : ranks.reduce((sum, value) => sum + value, 0) / timesRanked;
    const rankedOne = ranks.filter((rank) => rank === 1).length;
    const rankedTop3 = ranks.filter((rank) => rank <= 3).length;
    const rankedTopN = ranks.filter((rank) => rank <= input.fieldSize).length;

    const percentRankedTopN =
      input.sampleSize === 0 ? 0 : rankedTopN / input.sampleSize;

    return {
      rankableEntryId: entry.rankableEntryId,
      name: entry.name,
      team: entry.team,
      opponent: entry.opponent,
      actualRank: entry.actualRank,
      fantasyPoints: entry.fantasyPoints,
      actualResultFinal,
      averagePredictedRank,
      consensusRank: null,
      percentRankedOne:
        input.sampleSize === 0 ? 0 : rankedOne / input.sampleSize,
      percentRankedTop3:
        input.sampleSize === 0 ? 0 : rankedTop3 / input.sampleSize,
      percentRankedTopN,
      rankPercent: percentRankedTopN,
      selectionRate:
        input.sampleSize === 0 ? 0 : timesRanked / input.sampleSize,
      averageSelectedRank: averagePredictedRank,
      rankPercentRank: null,
      podiumPercent:
        input.sampleSize === 0 ? 0 : rankedTop3 / input.sampleSize,
      podiumPercentRank: null,
      averageRankRank: null,
      timesRanked,
      sampleSize: input.sampleSize,
      rankStdev: stdev(ranks),
      consensusVsActual: null,
    };
  });

  applyOrdinalRanks(withStats);

  const ranked = withStats
    .filter((entry) => entry.averagePredictedRank != null)
    .sort((a, b) => {
      const avgDiff =
        (a.averagePredictedRank ?? 999) - (b.averagePredictedRank ?? 999);
      if (avgDiff !== 0) return avgDiff;
      return b.timesRanked - a.timesRanked;
    });

  ranked.forEach((entry, index) => {
    entry.consensusRank = index + 1;
    if (entry.actualRank != null && entry.consensusRank != null) {
      entry.consensusVsActual = entry.actualRank - entry.consensusRank;
    }
  });

  const withActual = ranked.filter(
    (entry) =>
      entry.actualRank != null &&
      entry.consensusRank != null &&
      entry.actualRank <= input.fieldSize,
  );

  const biggestHit =
    withActual.length === 0
      ? null
      : withActual.reduce((best, entry) => {
          const bestDiff = Math.abs(best.consensusVsActual ?? 99);
          const nextDiff = Math.abs(entry.consensusVsActual ?? 99);
          return nextDiff < bestDiff ? entry : best;
        });

  const biggestMiss =
    withActual.length === 0
      ? null
      : withActual.reduce((worst, entry) => {
          const worstDiff = Math.abs(worst.consensusVsActual ?? -1);
          const nextDiff = Math.abs(entry.consensusVsActual ?? -1);
          return nextDiff > worstDiff ? entry : worst;
        });

  const polarizingPool = ranked.filter(
    (entry) => entry.rankStdev != null && entry.timesRanked >= 2,
  );
  const mostPolarizing =
    polarizingPool.length === 0
      ? null
      : polarizingPool.reduce((top, entry) =>
          (entry.rankStdev ?? 0) > (top.rankStdev ?? 0) ? entry : top,
        );

  const neverPicked = withStats.filter(
    (entry) => entry.averagePredictedRank == null,
  );

  return {
    entries: [...ranked, ...neverPicked],
    callouts: { biggestHit, biggestMiss, mostPolarizing },
  };
}

export function toPlayerConfidenceSignals(
  entry: ConsensusEntry,
): PlayerConfidenceSignals {
  return {
    rankableEntryId: entry.rankableEntryId,
    name: entry.name,
    rankPercent: entry.rankPercent,
    rankPercentRank: entry.rankPercentRank,
    podiumPercent: entry.podiumPercent,
    podiumPercentRank: entry.podiumPercentRank,
    averagePredictedRank: entry.averagePredictedRank,
    averageRankRank: entry.averageRankRank,
    sampleSize: entry.sampleSize,
    actualRank: entry.actualRank,
    fantasyPoints: entry.fantasyPoints,
    actualResultFinal: entry.actualResultFinal,
  };
}
