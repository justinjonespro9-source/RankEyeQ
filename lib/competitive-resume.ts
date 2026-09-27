/**
 * RankEyeQ-controlled competitive résumé: season standing + Trophy Case.
 *
 * Everything here is derived from canonical leaderboard rows
 * (`getSeasonBoardSet` → accumulate/toRows) — never from owner-editable fields.
 * Pure functions only; loaders live in `competitive-resume-data.ts`.
 *
 * Display rank (`row.rank`) keeps the canonical display-name tiebreak.
 * Achievements use competitive placement (`competitiveRanks`): profiles tied on
 * every performance criterion share a placement, so identity never decides hardware.
 */
import { qualifiesForTopPercentile } from "@/lib/badges/percentile";
import { PERCENTILE_CUTOFFS } from "@/lib/badges/thresholds";
import { profileBoardHref, weeklyReceiptsHref } from "@/lib/board-routes";
import {
  competitiveRanks,
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
  /** Canonical display rank (identical to the season leaderboard). */
  rank: number | null;
  /** Competitive placement — drives medal treatment; ties share it. */
  placement: number | null;
  tied: boolean;
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
  classRank: { label: string; placement: number; tied: boolean; fieldSize: number } | null;
  /** Best positional finish (lowest rank) — surfaced so elite specialists stand out. */
  strongestPosition: SeasonStandingCell | null;
};

export type Placement = 1 | 2 | 3;

export type TrophyKind =
  | "SEASON_OVERALL_CHAMPION"
  | "SEASON_POSITION_CHAMPION"
  | "WEEKLY_OVERALL_PLACEMENT"
  | "WEEKLY_POSITION_PLACEMENT"
  /** Reserved: manually / rule-awarded legacy honors (e.g. Founding Ranker · 2026). */
  | "FOUNDING_RANKER";

export type Trophy = {
  id: string;
  kind: TrophyKind;
  tier: "season" | "weekly" | "legacy";
  title: string;
  subtitle: string | null;
  seasonYear: number;
  weekNumber: number | null;
  position: ContestPosition | null;
  /** Competitive placement (1 = Champion, 2 = Runner-Up, 3 = Third Place). */
  place: Placement | null;
  /** Placement shared with at least one performance-identical profile. */
  tied: boolean;
  href: string | null;
  /** "derived" = reproducible from graded results; "awarded" = future persisted honors. */
  source: "derived" | "awarded";
};

export type TopTenFinish = {
  seasonYear: number;
  weekNumber: number;
  scope: StandingScope;
  /** Competitive placement on that weekly board. */
  placement: number;
  tied: boolean;
  fieldSize: number;
  href: string;
};

export type StreakRange = {
  seasonYear: number;
  fromWeek: number;
  toWeek: number;
  length: number;
  href: string;
};

export type HotStreakSummary = {
  threshold: number;
  current: StreakRange | null;
  longest: StreakRange | null;
};

/**
 * Participation rule a season-board leader must satisfy to earn a permanent
 * Season Champion trophy. No rule is approved yet, so season titles are gated off.
 */
export type SeasonChampionshipEligibility = {
  id: string;
  isEligible: (input: {
    row: LeaderboardRow;
    scope: StandingScope;
    set: SeasonBoardSet;
  }) => boolean;
};

export const APPROVED_SEASON_CHAMPIONSHIP_ELIGIBILITY: SeasonChampionshipEligibility | null =
  null;

export type TrophyCase = {
  trophies: Trophy[];
  topTenFinishes: TopTenFinish[];
  hotStreak: HotStreakSummary;
  /** False until a season-championship participation rule is approved. */
  seasonChampionshipsEnabled: boolean;
  counts: {
    seasonTitles: number;
    weeklyOverallWins: number;
    weeklyPositionWins: number;
    weeklyPodiums: number;
    topTenFinishes: number;
    /** Finalized weeks with a graded board on the overall weekly leaderboard. */
    weeksPlayed: number;
    /** Finalized weeks in the seasons considered. */
    weeksEligible: number;
  };
};

export const PLACEMENT_LABEL: Record<Placement, string> = {
  1: "Champion",
  2: "Runner-Up",
  3: "Third Place",
};

/** Résumé "#1 Call": ranked the player #1 and he finished #1 (display metric only). */
export function isNumberOneCall(pick: {
  predictedRank: number;
  actualRank: number | null;
}): boolean {
  return pick.predictedRank === 1 && pick.actualRank === 1;
}

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

/**
 * User-facing résumé rank. A performance tie shows only the shared placement
 * ("T-3"); the display-order number never appears beside it.
 */
export function formatCompetitiveRank(placement: number, tied: boolean): string {
  return tied ? `T-${placement}` : `#${placement}`;
}

function rowFor(board: LeaderboardRow[] | undefined, profileId: string) {
  return board?.find((row) => row.universalProfileId === profileId) ?? null;
}

/** Competitive placement of one profile on a board, plus whether it is shared. */
export function competitivePlacement(
  board: LeaderboardRow[],
  profileId: string,
): { placement: number; tied: boolean } | null {
  const ranks = competitiveRanks(board);
  const placement = ranks.get(profileId);
  if (placement == null) return null;
  let sharing = 0;
  for (const value of ranks.values()) if (value === placement) sharing += 1;
  return { placement, tied: sharing > 1 };
}

/**
 * Top 10% on a competitive placement: max(1, ceil(N × 0.10)) via the canonical
 * percentile helper. Every profile tied at a qualifying placement qualifies,
 * even if the tie group extends past the cutoff.
 */
export function isWeeklyTopTen(placement: number, fieldSize: number): boolean {
  return qualifiesForTopPercentile({
    rank: placement,
    cohortSize: fieldSize,
    percentile: WEEKLY_TOP_PERCENTILE,
  });
}

export function classFilterForStanding(input: {
  profileType: string;
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
  const competitive = board && row ? competitivePlacement(board, profileId) : null;
  return {
    scope,
    rank: row?.rank ?? null,
    placement: competitive?.placement ?? null,
    tied: competitive?.tied ?? false,
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
  const classPlacement = competitivePlacement(classBoard, profileId);

  const ranked = positions.filter((cell) => cell.placement != null);
  const strongestPosition =
    ranked.length === 0
      ? null
      : [...ranked].sort((a, b) => {
          if (a.placement! !== b.placement!) return a.placement! - b.placement!;
          return (b.averageScore ?? 0) - (a.averageScore ?? 0);
        })[0];

  return {
    seasonYear: set.seasonYear,
    seasonActive: set.seasonActive,
    seasonFinalized: isSeasonFinalized(set),
    cells: [overall, ...positions],
    classRank: classPlacement
      ? { label: input.classFilter.label, ...classPlacement, fieldSize: classBoard.length }
      : null,
    strongestPosition,
  };
}

function streakRuns(input: {
  seasonYear: number;
  username: string;
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
        run.href = weeklyReceiptsHref(input.username, input.seasonYear, week);
      } else {
        run = {
          seasonYear: input.seasonYear,
          fromWeek: week,
          toWeek: week,
          length: 1,
          href: weeklyReceiptsHref(input.username, input.seasonYear, week),
        };
        runs.push(run);
      }
    } else {
      run = null;
    }
    prev = week;
  }
  return runs;
}

function subtitleFor(seasonYear: number, tied: boolean) {
  return `${seasonYear} season${tied ? " · Tied" : ""}`;
}

function isPlacement(value: number): value is Placement {
  return value === 1 || value === 2 || value === 3;
}

/**
 * Derive the Trophy Case from canonical graded boards.
 *
 * - Weekly placements (Champion / Runner-Up / Third Place): competitive
 *   placement 1–3 on the full-field weekly overall board (once every contest
 *   that week is FINAL/ARCHIVED) or a weekly position board (contest FINAL).
 * - Top 10%: competitive placement ≤ max(1, ceil(N × 0.10)).
 * - Hot Streak: ≥3 consecutive finalized weeks with a Top-10% overall finish;
 *   a missed or non-Top-10% week breaks the streak; streaks reset each season.
 * - Season Champions: only for finalized seasons AND an approved participation
 *   rule (`APPROVED_SEASON_CHAMPIONSHIP_ELIGIBILITY`, currently none).
 */
export function deriveTrophyCase(input: {
  profileId: string;
  username: string;
  sets: SeasonBoardSet[];
  /** Override for tests; defaults to the approved rule (none in V1). */
  seasonChampionshipEligibility?: SeasonChampionshipEligibility | null;
  /** Future persisted honors (Founding Ranker, etc.). Empty in V1. */
  awarded?: Trophy[];
}): TrophyCase {
  const { profileId, username } = input;
  const eligibility =
    input.seasonChampionshipEligibility === undefined
      ? APPROVED_SEASON_CHAMPIONSHIP_ELIGIBILITY
      : input.seasonChampionshipEligibility;
  const sets = [...input.sets].sort((a, b) => a.seasonYear - b.seasonYear);

  const seasonTrophies: Trophy[] = [];
  const weeklyTrophies: Trophy[] = [];
  const topTenFinishes: TopTenFinish[] = [];
  let longest: StreakRange | null = null;
  let current: StreakRange | null = null;
  let weeksPlayed = 0;
  let weeksEligible = 0;

  for (const set of sets) {
    const year = set.seasonYear;
    const finalWeeks = finalizedWeekNumbers(set);
    const topTenOverallWeeks = new Set<number>();
    weeksEligible += finalWeeks.size;

    for (const week of set.weeks) {
      const overall = finalWeeks.has(week.weekNumber)
        ? competitivePlacement(week.overall, profileId)
        : null;
      if (overall) {
        weeksPlayed += 1;
        const href = weeklyReceiptsHref(username, year, week.weekNumber);
        if (isPlacement(overall.placement)) {
          weeklyTrophies.push({
            id: `weekly-overall-${year}-${week.weekNumber}`,
            kind: "WEEKLY_OVERALL_PLACEMENT",
            tier: "weekly",
            title: `Week ${week.weekNumber} Overall ${PLACEMENT_LABEL[overall.placement]}`,
            subtitle: subtitleFor(year, overall.tied),
            seasonYear: year,
            weekNumber: week.weekNumber,
            position: null,
            place: overall.placement,
            tied: overall.tied,
            href,
            source: "derived",
          });
        }
        if (isWeeklyTopTen(overall.placement, week.overall.length)) {
          topTenOverallWeeks.add(week.weekNumber);
          topTenFinishes.push({
            seasonYear: year,
            weekNumber: week.weekNumber,
            scope: "OVERALL",
            placement: overall.placement,
            tied: overall.tied,
            fieldSize: week.overall.length,
            href,
          });
        }
      }

      for (const position of RESUME_POSITIONS) {
        const board = week.byPosition[position];
        if (!board || !isPositionContestFinal(set, week.weekNumber, position)) continue;
        const result = competitivePlacement(board, profileId);
        if (!result) continue;
        const href = profileBoardHref(username, year, week.weekNumber, position);
        if (isPlacement(result.placement)) {
          weeklyTrophies.push({
            id: `weekly-${position}-${year}-${week.weekNumber}`,
            kind: "WEEKLY_POSITION_PLACEMENT",
            tier: "weekly",
            title: `Week ${week.weekNumber} ${position} ${PLACEMENT_LABEL[result.placement]}`,
            subtitle: subtitleFor(year, result.tied),
            seasonYear: year,
            weekNumber: week.weekNumber,
            position,
            place: result.placement,
            tied: result.tied,
            href,
            source: "derived",
          });
        }
        if (isWeeklyTopTen(result.placement, board.length)) {
          topTenFinishes.push({
            seasonYear: year,
            weekNumber: week.weekNumber,
            scope: position,
            placement: result.placement,
            tied: result.tied,
            fieldSize: board.length,
            href,
          });
        }
      }
    }

    const orderedFinalWeeks = [...finalWeeks].sort((a, b) => a - b);
    const runs = streakRuns({
      seasonYear: year,
      username,
      finalizedWeeks: orderedFinalWeeks,
      topTenWeeks: topTenOverallWeeks,
    });
    for (const run of runs) {
      if (!longest || run.length > longest.length) longest = run;
    }
    const lastFinal = orderedFinalWeeks[orderedFinalWeeks.length - 1];
    if (set.seasonActive && lastFinal != null) {
      current = runs.find((run) => run.toWeek === lastFinal) ?? null;
    }

    if (eligibility && isSeasonFinalized(set)) {
      const scopes: Array<[StandingScope, LeaderboardRow[] | undefined]> = [
        ["OVERALL", set.seasonOverall],
        ...RESUME_POSITIONS.map(
          (position) => [position, set.seasonByPosition[position]] as [StandingScope, LeaderboardRow[] | undefined],
        ),
      ];
      for (const [scope, board] of scopes) {
        const eligibleBoard = (board ?? []).filter((row) =>
          eligibility.isEligible({ row, scope, set }),
        );
        const result = competitivePlacement(eligibleBoard, profileId);
        if (result?.placement !== 1) continue;
        const isOverall = scope === "OVERALL";
        seasonTrophies.push({
          id: `season-${isOverall ? "overall" : scope}-${year}`,
          kind: isOverall ? "SEASON_OVERALL_CHAMPION" : "SEASON_POSITION_CHAMPION",
          tier: "season",
          title: `${year} Season ${isOverall ? "Overall" : scope} Champion`,
          subtitle: result.tied ? "Tied" : null,
          seasonYear: year,
          weekNumber: null,
          position: isOverall ? null : (scope as ContestPosition),
          place: 1,
          tied: result.tied,
          href: null,
          source: "derived",
        });
      }
    }
  }

  const weeklyOrder = (a: Trophy, b: Trophy) =>
    (a.place ?? 9) - (b.place ?? 9) ||
    (a.position == null ? 0 : 1) - (b.position == null ? 0 : 1) ||
    b.seasonYear - a.seasonYear ||
    (b.weekNumber ?? 0) - (a.weekNumber ?? 0);

  const trophies = [
    ...seasonTrophies.sort((a, b) => b.seasonYear - a.seasonYear),
    ...weeklyTrophies.sort(weeklyOrder),
    ...(input.awarded ?? []),
  ];

  topTenFinishes.sort(
    (a, b) =>
      b.seasonYear - a.seasonYear ||
      b.weekNumber - a.weekNumber ||
      (a.scope === "OVERALL" ? -1 : b.scope === "OVERALL" ? 1 : 0),
  );

  const wins = (kind: TrophyKind) =>
    weeklyTrophies.filter((t) => t.kind === kind && t.place === 1).length;

  return {
    trophies,
    topTenFinishes,
    hotStreak: {
      threshold: HOT_STREAK_MIN_WEEKS,
      current: current && current.length >= HOT_STREAK_MIN_WEEKS ? current : null,
      longest: longest && longest.length >= HOT_STREAK_MIN_WEEKS ? longest : null,
    },
    seasonChampionshipsEnabled: eligibility != null,
    counts: {
      seasonTitles: seasonTrophies.length,
      weeklyOverallWins: wins("WEEKLY_OVERALL_PLACEMENT"),
      weeklyPositionWins: wins("WEEKLY_POSITION_PLACEMENT"),
      weeklyPodiums: weeklyTrophies.length,
      topTenFinishes: topTenFinishes.length,
      weeksPlayed,
      weeksEligible,
    },
  };
}
