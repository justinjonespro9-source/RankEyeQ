/**
 * RankEyeQ-controlled competitive résumé: season standing + Trophy Case.
 *
 * Everything here is derived from canonical leaderboard rows
 * (`getSeasonBoardSet` → accumulate/toRows) — never from owner-editable fields.
 * Pure functions only; loaders live in `competitive-resume-data.ts`.
 */
import { qualifiesForTopPercentile } from "@/lib/badges/percentile";
import { PERCENTILE_CUTOFFS } from "@/lib/badges/thresholds";
import {
  filterLeaderboardRows,
  type LeaderboardFilter,
  type LeaderboardRow,
  type SeasonBoardSet,
} from "@/lib/leaderboards";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export const RESUME_POSITIONS: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];
export const HOT_STREAK_MIN_WEEKS = 3;
export const WEEKLY_TOP_PERCENTILE = PERCENTILE_CUTOFFS.top10;

const FINAL_CONTEST_STATUSES = new Set(["FINAL", "ARCHIVED"]);

export type StandingScope = "OVERALL" | ContestPosition;

export type SeasonStandingCell = {
  scope: StandingScope;
  rank: number | null;
  fieldSize: number;
  averageScore: number | null;
  contestsPlayed: number;
};

export type SeasonStanding = {
  seasonYear: number;
  seasonActive: boolean;
  seasonFinalized: boolean;
  cells: SeasonStandingCell[];
  /** Rank inside the profile's own class (e.g. among Experts) — context only. */
  classRank: { label: string; rank: number; fieldSize: number } | null;
  /** Best positional finish (lowest rank) — surfaced so elite specialists stand out. */
  strongestPosition: SeasonStandingCell | null;
};

export type TrophyKind =
  | "SEASON_OVERALL_CHAMPION"
  | "SEASON_POSITION_CHAMPION"
  | "WEEKLY_OVERALL_CHAMPION"
  | "WEEKLY_POSITION_CHAMPION"
  | "HOT_STREAK"
  /** Reserved: manually / rule-awarded legacy honors (e.g. Founding Ranker · 2026). */
  | "FOUNDING_RANKER";

export type Trophy = {
  id: string;
  kind: TrophyKind;
  tier: "season" | "weekly" | "streak" | "legacy";
  title: string;
  subtitle: string | null;
  seasonYear: number;
  weekNumber: number | null;
  position: ContestPosition | null;
  href: string | null;
  /** "derived" = reproducible from graded results; "awarded" = future persisted honors. */
  source: "derived" | "awarded";
};

export type TopTenFinish = {
  seasonYear: number;
  weekNumber: number;
  scope: StandingScope;
  rank: number;
  fieldSize: number;
  href: string;
};

export type StreakRange = {
  seasonYear: number;
  fromWeek: number;
  toWeek: number;
  length: number;
};

export type HotStreakSummary = {
  threshold: number;
  current: StreakRange | null;
  longest: StreakRange | null;
};

export type TrophyCase = {
  trophies: Trophy[];
  topTenFinishes: TopTenFinish[];
  hotStreak: HotStreakSummary;
  counts: {
    seasonTitles: number;
    weeklyOverallWins: number;
    weeklyPositionWins: number;
    topTenFinishes: number;
    /** Finalized weeks with a graded board on the overall weekly leaderboard. */
    weeksPlayed: number;
    /** Finalized weeks in the seasons considered. */
    weeksEligible: number;
  };
};

export function isContestFinal(status: string): boolean {
  return FINAL_CONTEST_STATUSES.has(status);
}

/** A week is final only when every contest scheduled for it is FINAL/ARCHIVED. */
export function finalizedWeekNumbers(set: Pick<SeasonBoardSet, "contests">): Set<number> {
  const byWeek = new Map<number, string[]>();
  for (const contest of set.contests) {
    const list = byWeek.get(contest.weekNumber) ?? [];
    list.push(contest.status);
    byWeek.set(contest.weekNumber, list);
  }
  const out = new Set<number>();
  for (const [weekNumber, statuses] of byWeek) {
    if (statuses.length > 0 && statuses.every(isContestFinal)) out.add(weekNumber);
  }
  return out;
}

/** Season titles require an inactive season whose every contest is FINAL/ARCHIVED. */
export function isSeasonFinalized(
  set: Pick<SeasonBoardSet, "seasonActive" | "contests">,
): boolean {
  return (
    !set.seasonActive &&
    set.contests.length > 0 &&
    set.contests.every((contest) => isContestFinal(contest.status))
  );
}

function isPositionContestFinal(
  set: Pick<SeasonBoardSet, "contests">,
  weekNumber: number,
  position: ContestPosition,
): boolean {
  const contest = set.contests.find(
    (c) => c.weekNumber === weekNumber && c.position === position,
  );
  return Boolean(contest && isContestFinal(contest.status));
}

function rowFor(board: LeaderboardRow[] | undefined, profileId: string) {
  return board?.find((row) => row.universalProfileId === profileId) ?? null;
}

export function isWeeklyTopTen(rank: number, fieldSize: number): boolean {
  return qualifiesForTopPercentile({
    rank,
    cohortSize: fieldSize,
    percentile: WEEKLY_TOP_PERCENTILE,
  });
}

export function positionBoardHref(
  username: string,
  weekNumber: number,
  position: ContestPosition,
): string {
  return `/profile/${username}/rankings/${weekNumber}/${position.toLowerCase()}`;
}

export function weeklyReceiptsHref(username: string, weekNumber: number): string {
  return `/profile/${username}?tab=rankiq#week-${weekNumber}`;
}

export function classFilterForStanding(input: {
  profileType: string;
  expertSourceKind?: string | null;
  isPublisherConsensus?: boolean;
}): { filter: LeaderboardFilter; label: string } {
  if (input.profileType === "BENCHMARK") {
    return input.isPublisherConsensus
      ? { filter: "PUBLISHER", label: "among Publisher Consensus" }
      : { filter: "EXPERT", label: "among Experts" };
  }
  if (input.profileType === "CREATOR") return { filter: "CREATOR", label: "among Creators" };
  if (input.profileType === "AI") return { filter: "AI", label: "among AI" };
  return { filter: "HUMAN", label: "among Public rankers" };
}

function standingCell(
  scope: StandingScope,
  board: LeaderboardRow[] | undefined,
  profileId: string,
): SeasonStandingCell {
  const row = rowFor(board, profileId);
  return {
    scope,
    rank: row?.rank ?? null,
    fieldSize: board?.length ?? 0,
    averageScore: row?.averageScore ?? null,
    contestsPlayed: row?.contestsPlayed ?? 0,
  };
}

/** Season standing straight off the canonical season boards (full field). */
export function buildSeasonStanding(input: {
  profileId: string;
  set: SeasonBoardSet;
  classFilter: { filter: LeaderboardFilter; label: string };
}): SeasonStanding {
  const { profileId, set } = input;
  const overall = standingCell("OVERALL", set.seasonOverall, profileId);
  const positions = RESUME_POSITIONS.map((position) =>
    standingCell(position, set.seasonByPosition[position], profileId),
  );

  const classBoard = filterLeaderboardRows(set.seasonOverall, input.classFilter.filter);
  const classRow = rowFor(classBoard, profileId);

  const ranked = positions.filter((cell) => cell.rank != null);
  const strongestPosition =
    ranked.length === 0
      ? null
      : [...ranked].sort((a, b) => {
          if (a.rank! !== b.rank!) return a.rank! - b.rank!;
          return (b.averageScore ?? 0) - (a.averageScore ?? 0);
        })[0];

  return {
    seasonYear: set.seasonYear,
    seasonActive: set.seasonActive,
    seasonFinalized: isSeasonFinalized(set),
    cells: [overall, ...positions],
    classRank: classRow
      ? { label: input.classFilter.label, rank: classRow.rank, fieldSize: classBoard.length }
      : null,
    strongestPosition,
  };
}

function streakRuns(input: {
  seasonYear: number;
  finalizedWeeks: number[];
  topTenWeeks: Set<number>;
}): StreakRange[] {
  const runs: StreakRange[] = [];
  let run: StreakRange | null = null;
  let prev: number | null = null;
  for (const week of input.finalizedWeeks) {
    const consecutive = prev != null && week === prev + 1;
    if (input.topTenWeeks.has(week)) {
      if (run && consecutive) {
        run.toWeek = week;
        run.length += 1;
      } else {
        run = { seasonYear: input.seasonYear, fromWeek: week, toWeek: week, length: 1 };
        runs.push(run);
      }
    } else {
      run = null;
    }
    prev = week;
  }
  return runs;
}

/**
 * Derive the Trophy Case from canonical graded boards.
 *
 * - Weekly Overall Champion: rank 1 on the full-field weekly overall board, only
 *   once every contest that week is FINAL/ARCHIVED.
 * - Weekly Position Champion: rank 1 on that week's position board (contest FINAL).
 * - Top 10%: `qualifiesForTopPercentile` (rank ≤ max(1, ceil(N × 0.10))).
 * - Hot Streak: ≥3 consecutive finalized weeks with a Top-10% overall finish;
 *   a missed or non-Top-10% week breaks the streak; streaks reset each season.
 * - Season Champions: rank 1 on the season board, only for finalized seasons.
 */
export function deriveTrophyCase(input: {
  profileId: string;
  username: string;
  sets: SeasonBoardSet[];
  /** Future persisted honors (Founding Ranker, etc.). Empty in V1. */
  awarded?: Trophy[];
}): TrophyCase {
  const { profileId, username } = input;
  const sets = [...input.sets].sort((a, b) => a.seasonYear - b.seasonYear);
  const multiSeason = sets.filter((s) => s.weeks.length > 0).length > 1;
  const seasonNote = (year: number) => (multiSeason ? `${year} season` : null);

  const seasonTrophies: Trophy[] = [];
  const weeklyOverall: Trophy[] = [];
  const weeklyPosition: Trophy[] = [];
  const topTenFinishes: TopTenFinish[] = [];
  let longest: StreakRange | null = null;
  let current: StreakRange | null = null;
  let weeksPlayed = 0;
  let weeksEligible = 0;

  for (const set of sets) {
    const finalWeeks = finalizedWeekNumbers(set);
    const topTenOverallWeeks = new Set<number>();
    weeksEligible += finalWeeks.size;

    for (const week of set.weeks) {
      const overallRow = rowFor(week.overall, profileId);
      if (overallRow && finalWeeks.has(week.weekNumber)) {
        weeksPlayed += 1;
        if (overallRow.rank === 1) {
          weeklyOverall.push({
            id: `weekly-overall-${set.seasonYear}-${week.weekNumber}`,
            kind: "WEEKLY_OVERALL_CHAMPION",
            tier: "weekly",
            title: `Week ${week.weekNumber} Overall Champion`,
            subtitle: seasonNote(set.seasonYear),
            seasonYear: set.seasonYear,
            weekNumber: week.weekNumber,
            position: null,
            href: weeklyReceiptsHref(username, week.weekNumber),
            source: "derived",
          });
        }
        if (isWeeklyTopTen(overallRow.rank, week.overall.length)) {
          topTenOverallWeeks.add(week.weekNumber);
          topTenFinishes.push({
            seasonYear: set.seasonYear,
            weekNumber: week.weekNumber,
            scope: "OVERALL",
            rank: overallRow.rank,
            fieldSize: week.overall.length,
            href: weeklyReceiptsHref(username, week.weekNumber),
          });
        }
      }

      for (const position of RESUME_POSITIONS) {
        const board = week.byPosition[position];
        const row = rowFor(board, profileId);
        if (!row || !board) continue;
        if (!isPositionContestFinal(set, week.weekNumber, position)) continue;
        const href = positionBoardHref(username, week.weekNumber, position);
        if (row.rank === 1) {
          weeklyPosition.push({
            id: `weekly-${position}-${set.seasonYear}-${week.weekNumber}`,
            kind: "WEEKLY_POSITION_CHAMPION",
            tier: "weekly",
            title: `Week ${week.weekNumber} ${position} Champion`,
            subtitle: seasonNote(set.seasonYear),
            seasonYear: set.seasonYear,
            weekNumber: week.weekNumber,
            position,
            href,
            source: "derived",
          });
        }
        if (isWeeklyTopTen(row.rank, board.length)) {
          topTenFinishes.push({
            seasonYear: set.seasonYear,
            weekNumber: week.weekNumber,
            scope: position,
            rank: row.rank,
            fieldSize: board.length,
            href,
          });
        }
      }
    }

    const orderedFinalWeeks = [...finalWeeks].sort((a, b) => a - b);
    const runs = streakRuns({
      seasonYear: set.seasonYear,
      finalizedWeeks: orderedFinalWeeks,
      topTenWeeks: topTenOverallWeeks,
    });
    for (const run of runs) {
      if (!longest || run.length > longest.length) longest = run;
    }
    const lastFinal = orderedFinalWeeks[orderedFinalWeeks.length - 1];
    if (set.seasonActive && lastFinal != null) {
      const tail = runs.find((run) => run.toWeek === lastFinal) ?? null;
      current = tail;
    }

    if (isSeasonFinalized(set)) {
      const overallRow = rowFor(set.seasonOverall, profileId);
      if (overallRow?.rank === 1) {
        seasonTrophies.push({
          id: `season-overall-${set.seasonYear}`,
          kind: "SEASON_OVERALL_CHAMPION",
          tier: "season",
          title: `${set.seasonYear} Season Overall Champion`,
          subtitle: null,
          seasonYear: set.seasonYear,
          weekNumber: null,
          position: null,
          href: null,
          source: "derived",
        });
      }
      for (const position of RESUME_POSITIONS) {
        const row = rowFor(set.seasonByPosition[position], profileId);
        if (row?.rank === 1) {
          seasonTrophies.push({
            id: `season-${position}-${set.seasonYear}`,
            kind: "SEASON_POSITION_CHAMPION",
            tier: "season",
            title: `${set.seasonYear} Season ${position} Champion`,
            subtitle: null,
            seasonYear: set.seasonYear,
            weekNumber: null,
            position,
            href: null,
            source: "derived",
          });
        }
      }
    }
  }

  const streakTrophies: Trophy[] =
    longest && longest.length >= HOT_STREAK_MIN_WEEKS
      ? [
          {
            id: `hot-streak-${longest.seasonYear}-${longest.fromWeek}`,
            kind: "HOT_STREAK",
            tier: "streak",
            title: `Hot Streak · ${longest.length} weeks`,
            subtitle: `Top 10% overall, Weeks ${longest.fromWeek}–${longest.toWeek}${
              multiSeason ? ` (${longest.seasonYear})` : ""
            }`,
            seasonYear: longest.seasonYear,
            weekNumber: longest.toWeek,
            position: null,
            href: weeklyReceiptsHref(username, longest.toWeek),
            source: "derived",
          },
        ]
      : [];

  const newestFirst = (a: Trophy, b: Trophy) =>
    b.seasonYear - a.seasonYear || (b.weekNumber ?? 0) - (a.weekNumber ?? 0);

  const trophies = [
    ...seasonTrophies.sort(newestFirst),
    ...weeklyOverall.sort(newestFirst),
    ...weeklyPosition.sort(newestFirst),
    ...streakTrophies,
    ...(input.awarded ?? []),
  ];

  topTenFinishes.sort(
    (a, b) =>
      b.seasonYear - a.seasonYear ||
      b.weekNumber - a.weekNumber ||
      (a.scope === "OVERALL" ? -1 : b.scope === "OVERALL" ? 1 : 0),
  );

  return {
    trophies,
    topTenFinishes,
    hotStreak: {
      threshold: HOT_STREAK_MIN_WEEKS,
      current: current && current.length >= HOT_STREAK_MIN_WEEKS ? current : null,
      longest: longest && longest.length >= HOT_STREAK_MIN_WEEKS ? longest : null,
    },
    counts: {
      seasonTitles: seasonTrophies.length,
      weeklyOverallWins: weeklyOverall.length,
      weeklyPositionWins: weeklyPosition.length,
      topTenFinishes: topTenFinishes.length,
      weeksPlayed,
      weeksEligible,
    },
  };
}
