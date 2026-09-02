import type { ContestPosition } from "@/lib/generated/prisma/client";

export type PlayerQualificationFilter = "ALL" | "MIN_4" | "MIN_8";

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
  | "name";

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
};

export type PlayerPerformanceRow = {
  rankableEntryId: string;
  name: string;
  team: string;
  position: ContestPosition;
  weeksEligible: number;
  weeksRecorded: number;
  averageFinish: number | null;
  medianFinish: number | null;
  top3Finishes: number;
  top5Finishes: number;
  top10Finishes: number;
  numberOneFinishes: number;
  bestFinish: number | null;
  worstFinish: number | null;
  /** Reserved for future consensus-vs-actual analytics. */
  averageConsensusRank: number | null;
  averageVsConsensus: number | null;
  appearances: PlayerWeeklyAppearance[];
};

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function meetsQualification(
  weeksRecorded: number,
  filter: PlayerQualificationFilter,
) {
  if (filter === "MIN_4") return weeksRecorded >= 4;
  if (filter === "MIN_8") return weeksRecorded >= 8;
  return true;
}

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
    const sample = playerRows[0];
    const weeksEligible = playerRows.filter((row) => row.wasActive).length;
    const recorded = playerRows.filter(
      (row) => row.wasActive && row.actualRank != null && row.actualRank > 0,
    );
    const finishes = recorded.map((row) => row.actualRank as number);
    const weeksRecorded = finishes.length;

    if (!meetsQualification(weeksRecorded, qualification)) continue;

    const consensusPairs = recorded.filter((row) => row.consensusRank != null);
    const averageVsConsensus =
      consensusPairs.length === 0
        ? null
        : consensusPairs.reduce(
            (sum, row) =>
              sum + ((row.consensusRank as number) - (row.actualRank as number)),
            0,
          ) / consensusPairs.length;

    aggregated.push({
      rankableEntryId,
      name: sample.name,
      team: sample.team,
      position: sample.position,
      weeksEligible,
      weeksRecorded,
      averageFinish:
        weeksRecorded === 0
          ? null
          : finishes.reduce((sum, value) => sum + value, 0) / weeksRecorded,
      medianFinish: median(finishes),
      top3Finishes: finishes.filter((value) => value <= 3).length,
      top5Finishes: finishes.filter((value) => value <= 5).length,
      top10Finishes: finishes.filter((value) => value <= 10).length,
      numberOneFinishes: finishes.filter((value) => value === 1).length,
      bestFinish: weeksRecorded === 0 ? null : Math.min(...finishes),
      worstFinish: weeksRecorded === 0 ? null : Math.max(...finishes),
      averageConsensusRank:
        consensusPairs.length === 0
          ? null
          : consensusPairs.reduce(
              (sum, row) => sum + (row.consensusRank as number),
              0,
            ) / consensusPairs.length,
      averageVsConsensus,
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
        case "averageFinish":
        default:
          return row.averageFinish ?? Number.POSITIVE_INFINITY;
      }
    }

    const left = value(a, sortKey);
    const right = value(b, sortKey);

    if (typeof left === "string" && typeof right === "string") {
      return left.localeCompare(right) * direction;
    }

    if (left === right) return a.name.localeCompare(b.name);
    return ((left as number) - (right as number)) * direction;
  });

  return aggregated;
}

export function mapContestEntriesToPerformanceSource(rows: {
  rankableEntryId: string;
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
}[]): PlayerPerformanceSourceRow[] {
  return rows.map((row) => ({
    rankableEntryId: row.rankableEntryId,
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
    contestFinal: row.contestStatus === "FINAL" || row.contestStatus === "ARCHIVED",
    consensusRank: row.consensusRank ?? null,
  }));
}
