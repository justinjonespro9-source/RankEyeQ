import type { ContestPosition } from "@/lib/generated/prisma/client";

/** Reusable historical research windows for ranking picker, /players, and detail pages. */
export type PlayerResearchWindow =
  | { type: "season" }
  | { type: "last3"; throughWeekNumber: number }
  | { type: "week"; weekNumber: number };

export type PlayerResearchStatLine = {
  rankableEntryId: string;
  name: string;
  team: string;
  position: ContestPosition;
  gamesPlayed: number;
  weeksInWindow: number;
  fantasyPointsTotal: number;
  fantasyPointsPerGame: number | null;
  averageFinish: number | null;
  top10Finishes: number;
  top5Finishes: number;
  numberOneFinishes: number;
  receptions: number;
  rushingYards: number;
  receivingYards: number;
  totalYards: number;
  touchdowns: number;
  passingYards: number;
  passingTds: number;
  interceptions: number;
};

export type PlayerResearchSortKey =
  | "name"
  | "team"
  | "fantasyPointsPerGame"
  | "fantasyPointsTotal"
  | "averageFinish"
  | "top10Finishes"
  | "top5Finishes"
  | "numberOneFinishes"
  | "receptions"
  | "totalYards"
  | "touchdowns";

/**
 * Last 3 NFL calendar weeks before `currentWeekNumber` (exclusive).
 * Entering Week 8 → Weeks 5, 6, 7.
 */
export function lastThreeNflWeekNumbers(currentWeekNumber: number): number[] {
  if (currentWeekNumber <= 1) return [];
  const start = Math.max(1, currentWeekNumber - 3);
  const end = currentWeekNumber - 1;
  const weeks: number[] = [];
  for (let week = start; week <= end; week += 1) {
    weeks.push(week);
  }
  return weeks;
}

export function parsePlayerResearchWindow(
  raw: string | null | undefined,
  currentWeekNumber: number,
): PlayerResearchWindow {
  if (!raw || raw === "season") return { type: "season" };
  if (raw === "last3") {
    return { type: "last3", throughWeekNumber: currentWeekNumber };
  }
  const weekMatch = /^week-(\d+)$/.exec(raw);
  if (weekMatch) {
    return { type: "week", weekNumber: Number(weekMatch[1]) };
  }
  return { type: "season" };
}

export function researchWindowLabel(
  window: PlayerResearchWindow,
  seasonYear: number,
): string {
  if (window.type === "season") return `${seasonYear} Season`;
  if (window.type === "last3") {
    const weeks = lastThreeNflWeekNumbers(window.throughWeekNumber);
    if (weeks.length === 0) return "Last 3 Weeks";
    return `Last 3 (Wk ${weeks[0]}–${weeks[weeks.length - 1]})`;
  }
  return `Week ${window.weekNumber}`;
}

export function weekNumbersForWindow(
  window: PlayerResearchWindow,
  allWeekNumbers: number[],
): number[] {
  if (window.type === "season") return allWeekNumbers;
  if (window.type === "week") {
    return allWeekNumbers.includes(window.weekNumber) ? [window.weekNumber] : [];
  }
  const target = new Set(
    lastThreeNflWeekNumbers(window.throughWeekNumber),
  );
  return allWeekNumbers.filter((week) => target.has(week));
}

type WeeklyAppearance = {
  rankableEntryId: string;
  name: string;
  team: string;
  position: ContestPosition;
  weekNumber: number;
  actualRank: number | null;
  fantasyPoints: number | null;
  receptions: number;
  rushingYards: number;
  receivingYards: number;
  passingYards: number;
  passingTds: number;
  interceptions: number;
  rushingTds: number;
  receivingTds: number;
};

export function aggregatePlayerResearchStats(
  appearances: WeeklyAppearance[],
  window: PlayerResearchWindow,
  allWeekNumbers: number[],
): PlayerResearchStatLine[] {
  const windowWeeks = weekNumbersForWindow(window, allWeekNumbers);
  const windowWeekSet = new Set(windowWeeks);

  const byPlayer = new Map<string, WeeklyAppearance[]>();
  for (const row of appearances) {
    if (!windowWeekSet.has(row.weekNumber)) continue;
    const list = byPlayer.get(row.rankableEntryId) ?? [];
    list.push(row);
    byPlayer.set(row.rankableEntryId, list);
  }

  const lines: PlayerResearchStatLine[] = [];

  for (const [rankableEntryId, rows] of byPlayer) {
    const sample = rows[0];
    const recorded = rows.filter(
      (row) => row.actualRank != null && row.actualRank > 0,
    );
    const finishes = recorded.map((row) => row.actualRank as number);
    const gamesPlayed = recorded.length;
    const fantasyPointsTotal = rows.reduce(
      (sum, row) => sum + (row.fantasyPoints ?? 0),
      0,
    );

    const rushingYards = rows.reduce((sum, row) => sum + row.rushingYards, 0);
    const receivingYards = rows.reduce(
      (sum, row) => sum + row.receivingYards,
      0,
    );
    const passingYards = rows.reduce((sum, row) => sum + row.passingYards, 0);
    const touchdowns =
      rows.reduce(
        (sum, row) =>
          sum + row.rushingTds + row.receivingTds + row.passingTds,
        0,
      );

    lines.push({
      rankableEntryId,
      name: sample.name,
      team: sample.team,
      position: sample.position,
      gamesPlayed,
      weeksInWindow: windowWeeks.length,
      fantasyPointsTotal,
      fantasyPointsPerGame:
        gamesPlayed === 0 ? null : fantasyPointsTotal / gamesPlayed,
      averageFinish:
        gamesPlayed === 0
          ? null
          : finishes.reduce((sum, value) => sum + value, 0) / gamesPlayed,
      top10Finishes: finishes.filter((value) => value <= 10).length,
      top5Finishes: finishes.filter((value) => value <= 5).length,
      numberOneFinishes: finishes.filter((value) => value === 1).length,
      receptions: rows.reduce((sum, row) => sum + row.receptions, 0),
      rushingYards,
      receivingYards,
      totalYards: rushingYards + receivingYards + passingYards,
      touchdowns,
      passingYards,
      passingTds: rows.reduce((sum, row) => sum + row.passingTds, 0),
      interceptions: rows.reduce((sum, row) => sum + row.interceptions, 0),
    });
  }

  return lines;
}

export function sortPlayerResearchStats(
  rows: PlayerResearchStatLine[],
  sortKey: PlayerResearchSortKey,
  direction: "asc" | "desc" = "desc",
): PlayerResearchStatLine[] {
  const factor = direction === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    function value(row: PlayerResearchStatLine) {
      switch (sortKey) {
        case "name":
          return row.name;
        case "team":
          return row.team;
        case "fantasyPointsTotal":
          return row.fantasyPointsTotal;
        case "fantasyPointsPerGame":
          return row.fantasyPointsPerGame ?? -1;
        case "averageFinish":
          return row.averageFinish ?? 999;
        case "top10Finishes":
          return row.top10Finishes;
        case "top5Finishes":
          return row.top5Finishes;
        case "numberOneFinishes":
          return row.numberOneFinishes;
        case "receptions":
          return row.receptions;
        case "totalYards":
          return row.totalYards;
        case "touchdowns":
          return row.touchdowns;
        default:
          return row.name;
      }
    }

    const left = value(a);
    const right = value(b);
    if (typeof left === "string" && typeof right === "string") {
      return left.localeCompare(right) * factor;
    }
    if (left === right) return a.name.localeCompare(b.name);
    return ((left as number) - (right as number)) * factor;
  });
}
