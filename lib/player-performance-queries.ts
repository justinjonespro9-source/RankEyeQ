import { prisma } from "@/lib/db";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import {
  aggregatePlayerPerformance,
  mapContestEntriesToPerformanceSource,
  type PlayerPerformanceRow,
  type PlayerPerformanceSortKey,
  type PlayerQualificationFilter,
} from "@/lib/player-performance";
import {
  parsePlayerResearchWindow,
  weekNumbersForWindow,
} from "@/lib/player-research";

export async function getPlayerPerformanceLeaderboard(input: {
  seasonId: string;
  position?: ContestPosition | "ALL";
  qualification?: PlayerQualificationFilter;
  sort?: PlayerPerformanceSortKey;
  sortDirection?: "asc" | "desc";
  includeTest?: boolean;
  /** season | last3 | week-N */
  window?: string;
  currentWeekNumber?: number;
}): Promise<{
  seasonYear: number;
  rows: PlayerPerformanceRow[];
}> {
  const season = await prisma.season.findUniqueOrThrow({
    where: { id: input.seasonId },
    include: {
      weeks: {
        where: input.includeTest ? undefined : { isTest: false },
        orderBy: { weekNumber: "asc" },
        select: { weekNumber: true },
      },
    },
  });

  const allWeekNumbers = season.weeks.map((week) => week.weekNumber);
  const currentWeek =
    input.currentWeekNumber ??
    allWeekNumbers[allWeekNumbers.length - 1] ??
    1;
  const parsedWindow = parsePlayerResearchWindow(
    input.window,
    currentWeek,
  );
  const allowedWeeks = new Set(
    weekNumbersForWindow(parsedWindow, allWeekNumbers),
  );

  const entries = await prisma.contestEntry.findMany({
    where: {
      contest: {
        seasonId: input.seasonId,
        ...(input.position && input.position !== "ALL"
          ? { position: input.position }
          : {}),
        week: input.includeTest ? undefined : { isTest: false },
      },
    },
    include: {
      rankableEntry: true,
      contest: { include: { week: true } },
    },
  });

  const filteredEntries = entries.filter((entry) =>
    allowedWeeks.has(entry.contest.week.weekNumber),
  );

  const source = mapContestEntriesToPerformanceSource(
    filteredEntries.map((entry) => ({
      rankableEntryId: entry.rankableEntryId,
      name: entry.rankableEntry.name,
      team: entry.rankableEntry.team,
      position: entry.contest.position,
      weekId: entry.contest.weekId,
      weekLabel: entry.contest.week.label,
      weekNumber: entry.contest.week.weekNumber,
      contestId: entry.contestId,
      weekTeam: entry.weekTeam,
      actualRank: entry.actualRank,
      fantasyPoints: entry.fantasyPoints,
      excluded: entry.excluded,
      contestStatus: entry.contest.status,
    })),
  );

  return {
    seasonYear: season.year,
    rows: aggregatePlayerPerformance(source, {
      position: input.position ?? "ALL",
      qualification: input.qualification ?? "ALL",
      sort: input.sort ?? "averageFinish",
      sortDirection: input.sortDirection ?? "asc",
    }),
  };
}

export async function getActiveSeasonForPerformance() {
  return prisma.season.findFirst({
    where: { active: true, sport: "NFL" },
    orderBy: { year: "desc" },
  });
}
