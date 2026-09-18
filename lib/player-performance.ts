import type { ContestPosition } from "@/lib/generated/prisma/client";
import {
  avgRankedPositionFromSums,
  rankedPctFromSums,
  topNThresholdForPosition,
} from "@/lib/player-performance-ranked";

export type PlayerQualificationFilter = "ALL" | "MIN_4" | "MIN_8";

export type PlayerPerformanceScope = "season" | "hot" | "week";

export type PlayerPerformanceSortKey =
  | "averageFinish"
  | "medianFinish"
  | "weeksRecorded"
  | "top3Finishes"
  | "top5Finishes"
  | "top10Finishes"
  | "numberOneFinishes"
  | "bestFinish"
  | "worstFinish"
  | "rankedPct"
  | "avgRankedPosition"
  | "name";

export type WeekPerformanceSortKey =
  | "name"
  | "actualRank"
  | "fantasyPoints"
  | "rankedPct"
  | "avgRankedPosition"
  | "consensusRank"
  | "consensusSelectedPct";

export type PlayerWeeklyAppearance = {
  weekId: string;
  weekLabel: string;
  weekNumber: number;
  contestId: string;
  position: ContestPosition;
  weekTeam: string | null;
  actualRank: number;
  fantasyPoints: number | null;
  consensusRank: number | null;
  actualResultFinal: boolean;
};

/** Raw row before aggregation — one per active weekly appearance with a graded finish. */
export type PlayerPerformanceSourceRow = {
  rankableEntryId: string;
  /** Prefer for public profile URLs when present (nflcom externalId). */
  externalId?: string | null;
  name: string;
  team: string;
  position: ContestPosition;
  weekId: string;
  weekLabel: string;
  weekNumber: number;
  contestId: string;
  weekTeam: string | null;
  actualRank: number | null;
  fantasyPoints: number | null;
  wasActive: boolean;
  contestFinal: boolean;
  consensusRank: number | null;
  /** Scoring-board selections for this contest (eligible official ballots). */
  scoringBoardSelections?: number;
  /** Eligible official ballot count for this contest. */
  eligibleBallotCount?: number;
  /** Sum of scoring-board predicted ranks for this contest. */
  scoringRankSum?: number;
};

export type PlayerPerformanceRow = {
  rankableEntryId: string;
  externalId: string | null;
  name: string;
  team: string;
  position: ContestPosition;
  weeksEligible: number;
  weeksRecorded: number;
  averageFinish: number | null;
  medianFinish: number | null;
  top3Finishes: number;
  top5Finishes: number;
  /**
   * Position-aware Top-N finishes (WR Top 15, QB/RB/TE/DEF Top 10).
   * Column label should use topNThreshold / topNLabelForPosition.
   */
  top10Finishes: number;
  topNThreshold: number;
  numberOneFinishes: number;
  bestFinish: number | null;
  worstFinish: number | null;
  /** Reserved for future consensus-vs-actual analytics. */
  averageConsensusRank: number | null;
  averageVsConsensus: number | null;
  /** Scoring-board Ranked % (summed selections / summed eligible ballots). */
  rankedPct: number | null;
  /** Avg scoring position among scoring-board selections only. */
  avgRankedPosition: number | null;
  scoringBoardSelections: number;
  eligibleBallotCount: number;
  appearances: PlayerWeeklyAppearance[];
};

/** Single-week leaderboard row (~Top 40 actual finishers). */
export type WeekPerformanceRow = {
  rankableEntryId: string;
  externalId: string | null;
  name: string;
  team: string;
  position: ContestPosition;
  actualRank: number;
  fantasyPoints: number | null;
  rankedPct: number | null;
  avgRankedPosition: number | null;
  consensusRank: number | null;
  /** Snapshot any-slot Selected % — distinct from Ranked %. */
  consensusSelectedPct: number | null;
  scoringBoardSelections: number;
  eligibleBallotCount: number;
};

export const WEEK_LEADERBOARD_LIMIT = 40;

export const OFFICIAL_PLAYER_PERFORMANCE_STATUSES = [
  "FINAL",
  "ARCHIVED",
] as const;

export function isOfficialPlayerPerformanceStatus(status: string): boolean {
  return status === "FINAL" || status === "ARCHIVED";
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function meetsQualification(
  weeksRecorded: number,
  filter: PlayerQualificationFilter,
) {
  if (filter === "MIN_4") return weeksRecorded >= 4;
  if (filter === "MIN_8") return weeksRecorded >= 8;
  return true;
}

/**
 * Aggregate season / Who's Hot rows.
 * Only contestFinal=true source rows contribute to official finishes
 * (callers must already exclude OPEN/LOCKED/GRADING).
 */
export function aggregatePlayerPerformance(
  rows: PlayerPerformanceSourceRow[],
  options: {
    position?: ContestPosition | "ALL";
    qualification?: PlayerQualificationFilter;
    sort?: PlayerPerformanceSortKey;
    sortDirection?: "asc" | "desc";
  } = {},
): PlayerPerformanceRow[] {
  const position = options.position ?? "ALL";
  const qualification = options.qualification ?? "ALL";
  const sortKey = options.sort ?? "averageFinish";
  const sortDirection = options.sortDirection ?? "asc";

  const filtered =
    position === "ALL" ? rows : rows.filter((row) => row.position === position);

  const byPlayer = new Map<string, PlayerPerformanceSourceRow[]>();
  for (const row of filtered) {
    const list = byPlayer.get(row.rankableEntryId) ?? [];
    list.push(row);
    byPlayer.set(row.rankableEntryId, list);
  }

  const aggregated: PlayerPerformanceRow[] = [];

  for (const [rankableEntryId, playerRows] of byPlayer) {
    const sample = playerRows[0]!;
    const weeksEligible = playerRows.filter((row) => row.wasActive).length;
    const recorded = playerRows.filter(
      (row) =>
        row.wasActive &&
        row.contestFinal &&
        row.actualRank != null &&
        row.actualRank > 0,
    );
    const finishes = recorded.map((row) => row.actualRank as number);
    const weeksRecorded = finishes.length;

    if (!meetsQualification(weeksRecorded, qualification)) continue;
    if (weeksRecorded === 0) continue;

    const topNThreshold = topNThresholdForPosition(sample.position);
    const consensusPairs = recorded.filter((row) => row.consensusRank != null);
    const averageVsConsensus =
      consensusPairs.length === 0
        ? null
        : consensusPairs.reduce(
            (sum, row) =>
              sum + ((row.consensusRank as number) - (row.actualRank as number)),
            0,
          ) / consensusPairs.length;

    const scoringBoardSelections = playerRows.reduce(
      (sum, row) => sum + (row.scoringBoardSelections ?? 0),
      0,
    );
    const eligibleBallotCount = playerRows.reduce(
      (sum, row) => sum + (row.eligibleBallotCount ?? 0),
      0,
    );
    const scoringRankSum = playerRows.reduce(
      (sum, row) => sum + (row.scoringRankSum ?? 0),
      0,
    );

    aggregated.push({
      rankableEntryId,
      externalId: sample.externalId ?? null,
      name: sample.name,
      team: sample.team,
      position: sample.position,
      weeksEligible,
      weeksRecorded,
      averageFinish:
        finishes.reduce((sum, value) => sum + value, 0) / weeksRecorded,
      medianFinish: median(finishes),
      top3Finishes: finishes.filter((value) => value <= 3).length,
      top5Finishes: finishes.filter((value) => value <= 5).length,
      top10Finishes: finishes.filter((value) => value <= topNThreshold).length,
      topNThreshold,
      numberOneFinishes: finishes.filter((value) => value === 1).length,
      bestFinish: Math.min(...finishes),
      worstFinish: Math.max(...finishes),
      averageConsensusRank:
        consensusPairs.length === 0
          ? null
          : consensusPairs.reduce(
              (sum, row) => sum + (row.consensusRank as number),
              0,
            ) / consensusPairs.length,
      averageVsConsensus,
      rankedPct: rankedPctFromSums(scoringBoardSelections, eligibleBallotCount),
      avgRankedPosition: avgRankedPositionFromSums(
        scoringRankSum,
        scoringBoardSelections,
      ),
      scoringBoardSelections,
      eligibleBallotCount,
      appearances: recorded.map((row) => ({
        weekId: row.weekId,
        weekLabel: row.weekLabel,
        weekNumber: row.weekNumber,
        contestId: row.contestId,
        position: row.position,
        weekTeam: row.weekTeam,
        actualRank: row.actualRank as number,
        fantasyPoints: row.fantasyPoints,
        consensusRank: row.consensusRank,
        actualResultFinal: row.contestFinal,
      })),
    });
  }

  aggregated.sort((a, b) => {
    const direction = sortDirection === "asc" ? 1 : -1;

    function value(row: PlayerPerformanceRow, key: PlayerPerformanceSortKey) {
      switch (key) {
        case "name":
          return row.name;
        case "weeksRecorded":
          return row.weeksRecorded;
        case "medianFinish":
          return row.medianFinish ?? Number.POSITIVE_INFINITY;
        case "top3Finishes":
          return row.top3Finishes;
        case "top5Finishes":
          return row.top5Finishes;
        case "top10Finishes":
          return row.top10Finishes;
        case "numberOneFinishes":
          return row.numberOneFinishes;
        case "bestFinish":
          return row.bestFinish ?? Number.POSITIVE_INFINITY;
        case "worstFinish":
          return row.worstFinish ?? Number.NEGATIVE_INFINITY;
        case "rankedPct":
          return row.rankedPct ?? (sortDirection === "asc" ? Number.POSITIVE_INFINITY : -1);
        case "avgRankedPosition":
          return row.avgRankedPosition ?? Number.POSITIVE_INFINITY;
        case "averageFinish":
        default:
          return row.averageFinish ?? Number.POSITIVE_INFINITY;
      }
    }

    const left = value(a, sortKey);
    const right = value(b, sortKey);

    if (typeof left === "string" && typeof right === "string") {
      const nameCmp = left.localeCompare(right) * direction;
      if (nameCmp !== 0) return nameCmp;
    } else if (left !== right) {
      return ((left as number) - (right as number)) * direction;
    }

    // Deterministic tie-breakers (Who's Hot default emphasis):
    // average finish → best finish → appearances → name
    const avg =
      (a.averageFinish ?? Number.POSITIVE_INFINITY) -
      (b.averageFinish ?? Number.POSITIVE_INFINITY);
    if (avg !== 0) return avg;
    const best =
      (a.bestFinish ?? Number.POSITIVE_INFINITY) -
      (b.bestFinish ?? Number.POSITIVE_INFINITY);
    if (best !== 0) return best;
    const apps = b.weeksRecorded - a.weeksRecorded;
    if (apps !== 0) return apps;
    return a.name.localeCompare(b.name);
  });

  return aggregated;
}

export function sortWeekPerformanceRows(
  rows: WeekPerformanceRow[],
  sort: WeekPerformanceSortKey,
  sortDirection: "asc" | "desc",
): WeekPerformanceRow[] {
  const direction = sortDirection === "asc" ? 1 : -1;
  const copy = [...rows];
  copy.sort((a, b) => {
    function value(row: WeekPerformanceRow, key: WeekPerformanceSortKey) {
      switch (key) {
        case "name":
          return row.name;
        case "fantasyPoints":
          return row.fantasyPoints ?? (sortDirection === "asc" ? Number.POSITIVE_INFINITY : -1);
        case "rankedPct":
          return row.rankedPct ?? (sortDirection === "asc" ? Number.POSITIVE_INFINITY : -1);
        case "avgRankedPosition":
          return row.avgRankedPosition ?? Number.POSITIVE_INFINITY;
        case "consensusRank":
          return row.consensusRank ?? Number.POSITIVE_INFINITY;
        case "consensusSelectedPct":
          return row.consensusSelectedPct ?? (sortDirection === "asc" ? Number.POSITIVE_INFINITY : -1);
        case "actualRank":
        default:
          return row.actualRank;
      }
    }
    const left = value(a, sort);
    const right = value(b, sort);
    if (typeof left === "string" && typeof right === "string") {
      const nameCmp = left.localeCompare(right) * direction;
      if (nameCmp !== 0) return nameCmp;
    } else if (left !== right) {
      return ((left as number) - (right as number)) * direction;
    }
    return a.actualRank - b.actualRank || a.name.localeCompare(b.name);
  });
  return copy;
}

export function mapContestEntriesToPerformanceSource(rows: {
  rankableEntryId: string;
  externalId?: string | null;
  name: string;
  team: string;
  position: ContestPosition;
  weekId: string;
  weekLabel: string;
  weekNumber: number;
  contestId: string;
  weekTeam: string | null;
  actualRank: number | null;
  fantasyPoints: number | null;
  excluded: boolean;
  contestStatus: string;
  consensusRank?: number | null;
  scoringBoardSelections?: number;
  eligibleBallotCount?: number;
  scoringRankSum?: number;
}[]): PlayerPerformanceSourceRow[] {
  return rows.map((row) => ({
    rankableEntryId: row.rankableEntryId,
    externalId: row.externalId ?? null,
    name: row.name,
    team: row.weekTeam ?? row.team,
    position: row.position,
    weekId: row.weekId,
    weekLabel: row.weekLabel,
    weekNumber: row.weekNumber,
    contestId: row.contestId,
    weekTeam: row.weekTeam,
    actualRank: row.actualRank,
    fantasyPoints: row.fantasyPoints,
    wasActive: !row.excluded,
    contestFinal: isOfficialPlayerPerformanceStatus(row.contestStatus),
    consensusRank: row.consensusRank ?? null,
    scoringBoardSelections: row.scoringBoardSelections,
    eligibleBallotCount: row.eligibleBallotCount,
    scoringRankSum: row.scoringRankSum,
  }));
}

/**
 * Completed NFL weeks = weeks that have at least one FINAL/ARCHIVED contest.
 * Never includes the current unfinished week (no FINAL contest yet).
 * Returns up to `limit` most recent week numbers ascending.
 */
export function lastCompletedFinalizedWeekNumbers(
  finalizedWeekNumbers: number[],
  limit = 3,
): number[] {
  const unique = [...new Set(finalizedWeekNumbers.filter((n) => n > 0))].sort(
    (a, b) => a - b,
  );
  if (unique.length <= limit) return unique;
  return unique.slice(unique.length - limit);
}

export function parsePlayerPerformanceScope(
  raw: string | null | undefined,
): PlayerPerformanceScope {
  if (raw === "hot") return "hot";
  if (raw === "week") return "week";
  return "season";
}

/**
 * Season alone honors All / 4+ / 8+ appearance filters.
 * Who's Hot and Week always treat qualification as ALL (ignore stale URL params).
 */
export function qualificationForPlayerPerformanceScope(
  scope: PlayerPerformanceScope,
  qualification: PlayerQualificationFilter | null | undefined,
): PlayerQualificationFilter {
  if (scope !== "season") return "ALL";
  return qualification ?? "ALL";
}

export function shouldShowPlayerPerformanceQualificationControls(
  scope: PlayerPerformanceScope,
): boolean {
  return scope === "season";
}
