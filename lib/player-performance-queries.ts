import { prisma } from "@/lib/db";
import { filterEligibleOfficialRankerSubmissions } from "@/lib/consensus-filters";
import type {
  ContestPosition,
  ProfileType,
  SubmissionStatus,
} from "@/lib/generated/prisma/client";
import {
  aggregatePlayerPerformance,
  isOfficialPlayerPerformanceStatus,
  lastCompletedFinalizedWeekNumbers,
  mapContestEntriesToPerformanceSource,
  parsePlayerPerformanceScope,
  qualificationForPlayerPerformanceScope,
  sortWeekPerformanceRows,
  WEEK_LEADERBOARD_LIMIT,
  type PlayerPerformanceRow,
  type PlayerPerformanceScope,
  type PlayerPerformanceSortKey,
  type PlayerQualificationFilter,
  type WeekPerformanceRow,
  type WeekPerformanceSortKey,
} from "@/lib/player-performance";
import {
  avgRankedPositionFromSums,
  rankedPctFromSums,
  scoringDepthForRankedMetric,
  tallyScoringBoardSelection,
} from "@/lib/player-performance-ranked";

type SubmissionPickRow = {
  rankableEntryId: string;
  predictedRank: number;
};

type ContestSubmissionBallot = {
  status: SubmissionStatus;
  profileType: ProfileType;
  sourceKind: string | null;
  competitorActive: boolean;
  publicVisible: boolean;
  publicFromWeekId: string | null;
  publicFromWeek: {
    id: string;
    weekNumber: number;
    seasonId: string;
    startsAt: Date;
  } | null;
  week: {
    id: string;
    weekNumber: number;
    seasonId: string;
    startsAt: Date;
  };
  picks: SubmissionPickRow[];
};

type LoadedContestSubmission = {
  status: SubmissionStatus;
  picks: SubmissionPickRow[];
  universalProfile: {
    profileType: ProfileType;
    competitorActive: boolean;
    publicVisible: boolean;
    publicFromWeekId: string | null;
    publicFromWeek: {
      id: string;
      weekNumber: number;
      seasonId: string;
      startsAt: Date;
    } | null;
    expertSource: { sourceKind: string } | null;
  };
};

function toEligibleBallots(input: {
  submissions: LoadedContestSubmission[];
  week: {
    id: string;
    weekNumber: number;
    seasonId: string;
    startsAt: Date;
  };
}): ContestSubmissionBallot[] {
  const mapped: ContestSubmissionBallot[] = input.submissions.map(
    (submission) => ({
      status: submission.status,
      profileType: submission.universalProfile.profileType,
      sourceKind: submission.universalProfile.expertSource?.sourceKind ?? null,
      competitorActive: submission.universalProfile.competitorActive,
      publicVisible: submission.universalProfile.publicVisible,
      publicFromWeekId: submission.universalProfile.publicFromWeekId,
      publicFromWeek: submission.universalProfile.publicFromWeek,
      week: input.week,
      picks: submission.picks,
    }),
  );
  // All official rankers: Human + Creator + Expert + Publisher + AI.
  // Not consensus ballot_union All and not group-weighted Consensus All.
  return filterEligibleOfficialRankerSubmissions(mapped);
}

function scoringTalliesByPlayer(input: {
  rankableEntryIds: string[];
  scoringDepth: number;
  eligibleBallots: ContestSubmissionBallot[];
}): Map<
  string,
  {
    scoringBoardSelections: number;
    eligibleBallotCount: number;
    scoringRankSum: number;
  }
> {
  const map = new Map<
    string,
    {
      scoringBoardSelections: number;
      eligibleBallotCount: number;
      scoringRankSum: number;
    }
  >();
  const eligibleBallotCount = input.eligibleBallots.length;
  for (const rankableEntryId of input.rankableEntryIds) {
    const tally = tallyScoringBoardSelection({
      rankableEntryId,
      scoringDepth: input.scoringDepth,
      eligibleBallots: input.eligibleBallots,
    });
    map.set(rankableEntryId, {
      scoringBoardSelections: tally.scoringBoardSelections,
      eligibleBallotCount,
      scoringRankSum: tally.scoringRankSum,
    });
  }
  return map;
}

async function loadContestsForPerformance(input: {
  seasonId: string;
  position?: ContestPosition | "ALL";
  weekNumbers?: number[];
  weekId?: string;
  includeTest?: boolean;
  /** When true, only FINAL/ARCHIVED. When false, load any status (week provisional). */
  officialOnly: boolean;
}) {
  return prisma.rankIQContest.findMany({
    where: {
      seasonId: input.seasonId,
      ...(input.position && input.position !== "ALL"
        ? { position: input.position }
        : {}),
      ...(input.officialOnly
        ? { status: { in: ["FINAL", "ARCHIVED"] } }
        : {}),
      ...(input.weekId ? { weekId: input.weekId } : {}),
      week: {
        ...(input.includeTest ? {} : { isTest: false }),
        ...(input.weekNumbers && input.weekNumbers.length > 0
          ? { weekNumber: { in: input.weekNumbers } }
          : {}),
      },
    },
    include: {
      week: true,
      entries: {
        include: { rankableEntry: true },
      },
      pregameSnapshot: {
        include: { entries: true },
      },
      submissions: {
        select: {
          status: true,
          picks: {
            select: { rankableEntryId: true, predictedRank: true },
          },
          universalProfile: {
            select: {
              profileType: true,
              competitorActive: true,
              publicVisible: true,
              publicFromWeekId: true,
              publicFromWeek: {
                select: {
                  id: true,
                  weekNumber: true,
                  seasonId: true,
                  startsAt: true,
                },
              },
              expertSource: { select: { sourceKind: true } },
            },
          },
        },
      },
    },
    orderBy: [{ week: { weekNumber: "asc" } }, { position: "asc" }],
  });
}

export type PlayerPerformanceLeaderboardResult = {
  seasonYear: number;
  scope: PlayerPerformanceScope;
  rows: PlayerPerformanceRow[];
  weekRows: WeekPerformanceRow[];
  /** Who's Hot sample week numbers (ascending). */
  hotWeekNumbers: number[];
  /** Selected week for Week scope. */
  weekId: string | null;
  weekLabel: string | null;
  weekNumber: number | null;
  weekContestStatus: string | null;
  weekOfficial: boolean;
  weekUnavailableReason: string | null;
};

export async function getPlayerPerformanceLeaderboard(input: {
  seasonId: string;
  position?: ContestPosition | "ALL";
  qualification?: PlayerQualificationFilter;
  sort?: PlayerPerformanceSortKey;
  sortDirection?: "asc" | "desc";
  weekSort?: WeekPerformanceSortKey;
  includeTest?: boolean;
  /** @deprecated Prefer scope= */
  window?: string;
  scope?: string;
  weekId?: string;
  currentWeekNumber?: number;
}): Promise<PlayerPerformanceLeaderboardResult> {
  const season = await prisma.season.findUniqueOrThrow({
    where: { id: input.seasonId },
    include: {
      weeks: {
        where: input.includeTest ? undefined : { isTest: false },
        orderBy: { weekNumber: "asc" },
        select: { id: true, weekNumber: true, label: true },
      },
    },
  });

  // Prefer explicit scope=. Deprecated window=last3 → hot.
  // Deprecated window=week-N stays season aggregation filtered to that week
  // (not the new Top-40 Week scope, which requires scope=week&weekId=).
  const legacyWeekMatch = /^week-(\d+)$/.exec(input.window ?? "");
  const legacyWeekNumber = legacyWeekMatch
    ? Number(legacyWeekMatch[1])
    : null;

  const scope = parsePlayerPerformanceScope(
    input.scope ?? (input.window === "last3" ? "hot" : "season"),
  );

  const position = input.position ?? "ALL";

  if (scope === "week") {
    return loadWeekScope({
      season,
      seasonId: input.seasonId,
      position,
      weekId: input.weekId,
      includeTest: input.includeTest,
      weekSort: input.weekSort ?? "actualRank",
      sortDirection: input.sortDirection ?? "asc",
    });
  }

  let hotWeekNumbers: number[] = [];
  let weekNumbers: number[] | undefined;

  if (scope === "hot") {
    const finalizedContests = await prisma.rankIQContest.findMany({
      where: {
        seasonId: input.seasonId,
        status: { in: ["FINAL", "ARCHIVED"] },
        ...(position !== "ALL" ? { position } : {}),
        week: input.includeTest ? undefined : { isTest: false },
      },
      select: { week: { select: { weekNumber: true } } },
    });
    hotWeekNumbers = lastCompletedFinalizedWeekNumbers(
      finalizedContests.map((c) => c.week.weekNumber),
      3,
    );
    weekNumbers = hotWeekNumbers;
  } else if (legacyWeekNumber != null) {
    weekNumbers = [legacyWeekNumber];
  }

  const contests = await loadContestsForPerformance({
    seasonId: input.seasonId,
    position,
    weekNumbers,
    includeTest: input.includeTest,
    officialOnly: true,
  });

  const sourceRows = contests.flatMap((contest) => {
    const eligible = toEligibleBallots({
      submissions: contest.submissions as LoadedContestSubmission[],
      week: {
        id: contest.week.id,
        weekNumber: contest.week.weekNumber,
        seasonId: contest.week.seasonId,
        startsAt: contest.week.startsAt,
      },
    });
    const scoringDepth = scoringDepthForRankedMetric(
      contest.position,
      contest.rankingDepth,
    );
    const tallies = scoringTalliesByPlayer({
      rankableEntryIds: contest.entries.map((e) => e.rankableEntryId),
      scoringDepth,
      eligibleBallots: eligible,
    });
    const snapByPlayer = new Map(
      contest.pregameSnapshot?.entries.map((e) => [e.rankableEntryId, e]) ?? [],
    );

    return mapContestEntriesToPerformanceSource(
      contest.entries.map((entry) => {
        const tally = tallies.get(entry.rankableEntryId);
        const snap = snapByPlayer.get(entry.rankableEntryId);
        return {
          rankableEntryId: entry.rankableEntryId,
          externalId: entry.rankableEntry.externalId,
          name: entry.rankableEntry.name,
          team: entry.rankableEntry.team,
          position: contest.position,
          weekId: contest.weekId,
          weekLabel: contest.week.label,
          weekNumber: contest.week.weekNumber,
          contestId: contest.id,
          weekTeam: entry.weekTeam,
          actualRank: entry.actualRank,
          fantasyPoints: entry.fantasyPoints,
          excluded: entry.excluded,
          contestStatus: contest.status,
          consensusRank: snap?.consensusRankAll ?? null,
          scoringBoardSelections: tally?.scoringBoardSelections ?? 0,
          eligibleBallotCount: tally?.eligibleBallotCount ?? eligible.length,
          scoringRankSum: tally?.scoringRankSum ?? 0,
        };
      }),
    );
  });

  // Safety: never include non-official contests in season/hot aggregates.
  const officialSource = sourceRows.filter((row) => row.contestFinal);

  // Who's Hot ignores season qualification URL params (always ALL appearances
  // in the finalized window). Season preserves All / 4+ / 8+.
  const qualification = qualificationForPlayerPerformanceScope(
    scope,
    input.qualification ?? "ALL",
  );

  return {
    seasonYear: season.year,
    scope,
    rows: aggregatePlayerPerformance(officialSource, {
      position,
      qualification,
      sort: input.sort ?? "averageFinish",
      sortDirection: input.sortDirection ?? "asc",
    }),
    weekRows: [],
    hotWeekNumbers,
    weekId: null,
    weekLabel: null,
    weekNumber: null,
    weekContestStatus: null,
    weekOfficial: false,
    weekUnavailableReason: null,
  };
}

async function loadWeekScope(input: {
  season: {
    id: string;
    year: number;
    weeks: { id: string; weekNumber: number; label: string }[];
  };
  seasonId: string;
  position: ContestPosition | "ALL";
  weekId?: string;
  includeTest?: boolean;
  weekSort: WeekPerformanceSortKey;
  sortDirection: "asc" | "desc";
}): Promise<PlayerPerformanceLeaderboardResult> {
  const empty = (
    reason: string,
    weekMeta?: {
      weekId: string;
      weekLabel: string;
      weekNumber: number;
      status: string | null;
    },
  ): PlayerPerformanceLeaderboardResult => ({
    seasonYear: input.season.year,
    scope: "week",
    rows: [],
    weekRows: [],
    hotWeekNumbers: [],
    weekId: weekMeta?.weekId ?? null,
    weekLabel: weekMeta?.weekLabel ?? null,
    weekNumber: weekMeta?.weekNumber ?? null,
    weekContestStatus: weekMeta?.status ?? null,
    weekOfficial: false,
    weekUnavailableReason: reason,
  });

  if (input.position === "ALL") {
    return empty(
      "Week view requires a specific position — actual finishes are position-relative.",
    );
  }

  const weeks = input.season.weeks;
  const selectedWeek =
    (input.weekId
      ? weeks.find((w) => w.id === input.weekId)
      : null) ??
    weeks[weeks.length - 1] ??
    null;

  if (!selectedWeek) {
    return empty("No weeks available for this season.");
  }

  const contests = await loadContestsForPerformance({
    seasonId: input.seasonId,
    position: input.position,
    weekId: selectedWeek.id,
    includeTest: input.includeTest,
    officialOnly: false,
  });

  const contest = contests[0] ?? null;
  if (!contest) {
    return empty(
      `No ${input.position} contest found for ${selectedWeek.label}.`,
      {
        weekId: selectedWeek.id,
        weekLabel: selectedWeek.label,
        weekNumber: selectedWeek.weekNumber,
        status: null,
      },
    );
  }

  const weekOfficial = isOfficialPlayerPerformanceStatus(contest.status);
  if (!weekOfficial) {
    return {
      seasonYear: input.season.year,
      scope: "week",
      rows: [],
      weekRows: [],
      hotWeekNumbers: [],
      weekId: selectedWeek.id,
      weekLabel: selectedWeek.label,
      weekNumber: selectedWeek.weekNumber,
      weekContestStatus: contest.status,
      weekOfficial: false,
      weekUnavailableReason: `Week results are ${contest.status === "GRADING" ? "provisional (still grading)" : "not yet finalized"} (${contest.status}). Official finishes appear when the contest is FINAL.`,
    };
  }

  const eligible = toEligibleBallots({
    submissions: contest.submissions as LoadedContestSubmission[],
    week: {
      id: contest.week.id,
      weekNumber: contest.week.weekNumber,
      seasonId: contest.week.seasonId,
      startsAt: contest.week.startsAt,
    },
  });
  const scoringDepth = scoringDepthForRankedMetric(
    contest.position,
    contest.rankingDepth,
  );
  const snapByPlayer = new Map(
    contest.pregameSnapshot?.entries.map((e) => [e.rankableEntryId, e]) ?? [],
  );

  // Canonical actual ranks from ContestEntry — never invent ranks for missing players.
  const rankedEntries = contest.entries
    .filter(
      (entry) =>
        !entry.excluded &&
        entry.actualRank != null &&
        entry.actualRank > 0,
    )
    .sort((a, b) => (a.actualRank as number) - (b.actualRank as number))
    .slice(0, WEEK_LEADERBOARD_LIMIT);

  const tallies = scoringTalliesByPlayer({
    rankableEntryIds: rankedEntries.map((e) => e.rankableEntryId),
    scoringDepth,
    eligibleBallots: eligible,
  });

  const weekRows: WeekPerformanceRow[] = rankedEntries.map((entry) => {
    const tally = tallies.get(entry.rankableEntryId);
    const snap = snapByPlayer.get(entry.rankableEntryId);
    const scoringBoardSelections = tally?.scoringBoardSelections ?? 0;
    const eligibleBallotCount =
      tally?.eligibleBallotCount ?? eligible.length;
    return {
      rankableEntryId: entry.rankableEntryId,
      externalId: entry.rankableEntry.externalId,
      name: entry.rankableEntry.name,
      team: entry.weekTeam ?? entry.rankableEntry.team,
      position: contest.position,
      actualRank: entry.actualRank as number,
      fantasyPoints: entry.fantasyPoints,
      rankedPct: rankedPctFromSums(scoringBoardSelections, eligibleBallotCount),
      avgRankedPosition: avgRankedPositionFromSums(
        tally?.scoringRankSum ?? 0,
        scoringBoardSelections,
      ),
      consensusRank: snap?.consensusRankAll ?? null,
      consensusSelectedPct: snap?.selectionRateAll ?? null,
      scoringBoardSelections,
      eligibleBallotCount,
    };
  });

  return {
    seasonYear: input.season.year,
    scope: "week",
    rows: [],
    weekRows: sortWeekPerformanceRows(
      weekRows,
      input.weekSort,
      input.sortDirection,
    ),
    hotWeekNumbers: [],
    weekId: selectedWeek.id,
    weekLabel: selectedWeek.label,
    weekNumber: selectedWeek.weekNumber,
    weekContestStatus: contest.status,
    weekOfficial: true,
    weekUnavailableReason: null,
  };
}

export async function getActiveSeasonForPerformance() {
  return prisma.season.findFirst({
    where: { active: true, sport: "NFL" },
    orderBy: { year: "desc" },
  });
}

export async function listSeasonWeeksForPerformance(input: {
  seasonId: string;
  includeTest?: boolean;
}) {
  return prisma.week.findMany({
    where: {
      seasonId: input.seasonId,
      ...(input.includeTest ? {} : { isTest: false }),
    },
    orderBy: { weekNumber: "asc" },
    select: { id: true, weekNumber: true, label: true },
  });
}
