import type { ContestPosition } from "@/lib/generated/prisma/client";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";

export type HistoricalNavContest = {
  id: string;
  weekId: string;
  weekNumber: number;
  weekLabel: string;
  position: ContestPosition;
  status: string;
};

export type HistoricalWeekNavItem = {
  weekId: string;
  weekNumber: number;
  weekLabel: string;
};

const POSITION_SET = new Set<string>(CONTEST_POSITIONS);

export function parseContestPosition(
  raw: string | null | undefined,
  fallback: ContestPosition = "QB",
): ContestPosition {
  const upper = raw?.trim().toUpperCase() ?? "";
  if (POSITION_SET.has(upper)) return upper as ContestPosition;
  return fallback;
}

/** Canonical Results / My Ranks / Consensus query string. */
export function historicalNavQuery(input: {
  weekId: string;
  position: ContestPosition;
  extra?: Record<string, string | undefined>;
}): string {
  const params = new URLSearchParams();
  params.set("weekId", input.weekId);
  params.set("position", input.position);
  if (input.extra) {
    for (const [key, value] of Object.entries(input.extra)) {
      if (value != null && value !== "") params.set(key, value);
    }
  }
  return params.toString();
}

export function resultsHref(input: {
  weekId: string;
  position: ContestPosition;
  adminTest?: boolean;
}): string {
  const q = historicalNavQuery({
    weekId: input.weekId,
    position: input.position,
    extra: input.adminTest ? { adminTest: "1" } : undefined,
  });
  return `/results?${q}`;
}

/** My Ranks href — lowercase position (existing URL convention). */
export function buildMyRanksHref(input: {
  weekId: string;
  position: ContestPosition;
}): string {
  const params = new URLSearchParams({
    weekId: input.weekId,
    position: input.position.toLowerCase(),
  });
  return `/my-ranks?${params.toString()}`;
}

export function buildConsensusHref(input: {
  weekId: string;
  position: ContestPosition;
  filter?: string;
  view?: string;
}): string {
  const params = new URLSearchParams({
    weekId: input.weekId,
    position: input.position,
  });
  if (input.filter) params.set("filter", input.filter);
  if (input.view) params.set("view", input.view);
  return `/consensus?${params.toString()}`;
}

export function uniqueWeeksFromContests(
  contests: readonly HistoricalNavContest[],
): HistoricalWeekNavItem[] {
  const byId = new Map<string, HistoricalWeekNavItem>();
  for (const contest of contests) {
    if (!byId.has(contest.weekId)) {
      byId.set(contest.weekId, {
        weekId: contest.weekId,
        weekNumber: contest.weekNumber,
        weekLabel: contest.weekLabel,
      });
    }
  }
  return [...byId.values()].sort((a, b) => b.weekNumber - a.weekNumber);
}

export function positionsForWeek(
  contests: readonly HistoricalNavContest[],
  weekId: string,
): ContestPosition[] {
  const found = new Set<ContestPosition>();
  for (const contest of contests) {
    if (contest.weekId === weekId) found.add(contest.position);
  }
  return CONTEST_POSITIONS.filter((pos) => found.has(pos));
}

/**
 * Resolve the Results contest from contestId and/or weekId+position.
 *
 * Priority:
 * 1. Valid contestId deep link
 * 2. weekId + position (when both resolve to a FINAL/ARCHIVED contest)
 * 3. weekId + default/first available position
 * 4. Most recent FINAL week + default/first available position
 */
export function resolveResultsSelection(input: {
  contests: readonly HistoricalNavContest[];
  contestId?: string | null;
  weekId?: string | null;
  position?: string | null;
  defaultPosition?: ContestPosition;
}): {
  selectedContest: HistoricalNavContest | null;
  selectedWeekId: string | null;
  selectedPosition: ContestPosition | null;
  weeks: HistoricalWeekNavItem[];
  positions: ContestPosition[];
} {
  const contests = input.contests;
  const weeks = uniqueWeeksFromContests(contests);
  const defaultPosition = input.defaultPosition ?? "QB";

  if (contests.length === 0) {
    return {
      selectedContest: null,
      selectedWeekId: null,
      selectedPosition: null,
      weeks: [],
      positions: [],
    };
  }

  const byContestId = input.contestId
    ? contests.find((c) => c.id === input.contestId)
    : undefined;

  if (byContestId) {
    return {
      selectedContest: byContestId,
      selectedWeekId: byContestId.weekId,
      selectedPosition: byContestId.position,
      weeks,
      positions: positionsForWeek(contests, byContestId.weekId),
    };
  }

  const requestedWeekId =
    input.weekId && weeks.some((w) => w.weekId === input.weekId)
      ? input.weekId
      : weeks[0]!.weekId;

  const weekPositions = positionsForWeek(contests, requestedWeekId);
  const requestedPosition = parseContestPosition(
    input.position,
    defaultPosition,
  );
  const selectedPosition = weekPositions.includes(requestedPosition)
    ? requestedPosition
    : (weekPositions[0] ?? defaultPosition);

  const selectedContest =
    contests.find(
      (c) => c.weekId === requestedWeekId && c.position === selectedPosition,
    ) ?? null;

  return {
    selectedContest,
    selectedWeekId: requestedWeekId,
    selectedPosition,
    weeks,
    positions: weekPositions,
  };
}

/**
 * Default My Ranks week when no weekId query is present.
 *
 * 1. Active week if the user has an eligible submission there
 * 2. Else most recent weekNumber with an eligible submission
 * 3. Else active week (empty state)
 */
export function resolveMyRanksDefaultWeekId(input: {
  activeWeekId: string;
  submissions: readonly { weekId: string; weekNumber: number }[];
}): string {
  if (input.submissions.some((s) => s.weekId === input.activeWeekId)) {
    return input.activeWeekId;
  }
  if (input.submissions.length === 0) {
    return input.activeWeekId;
  }
  const sorted = [...input.submissions].sort(
    (a, b) => b.weekNumber - a.weekNumber,
  );
  return sorted[0]!.weekId;
}
