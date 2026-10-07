import { WAIVER_POSITIONS, type WaiverPosition } from "@/lib/waivers/constants";
import { divideRoundHalfAwayFromZero } from "@/lib/waivers/precision";

/**
 * Waivers leaderboard read model (pure). It never scores: every value comes
 * from authoritative graded board records, and this module only aggregates
 * them. A submitted zero-call board stays N/A for Waiver EyeQ, FP / Call and
 * Perfect Calls (never zero), and contributes 0.0 FP over its available slots.
 */

export type WaiverLeaderboardScope = "weekly" | "season";
export type WaiverLeaderboardPosition = "ALL" | WaiverPosition;

export const WAIVER_LEADERBOARD_POSITIONS: readonly WaiverLeaderboardPosition[] = ["ALL", ...WAIVER_POSITIONS];

export function parseWaiverLeaderboardPosition(raw: string | undefined): WaiverLeaderboardPosition {
  const upper = (raw ?? "").toUpperCase();
  return (WAIVER_POSITIONS as readonly string[]).includes(upper) ? (upper as WaiverPosition) : "ALL";
}

/** One competing board exactly as authoritative Waivers grading records it. */
export type WaiverGradedBoard = {
  universalProfileId: string;
  weekId: string;
  position: WaiverPosition;
  availableSlots: number;
  callsMade: number;
  /** Integer hundredths; null = N/A. */
  eyeqHundredths: number | null;
  totalFpHundredths: number;
  /** Exact-slot calls; null = N/A. */
  perfectCalls: number | null;
};

export type WaiverLeaderboardRow = {
  universalProfileId: string;
  /** Shared competition rank by Avg Waiver EyeQ; null when every board is N/A. */
  rank: number | null;
  played: number;
  calls: number;
  avgEyeqHundredths: number | null;
  fpPerCallHundredths: number | null;
  fpPerAvailableSlotHundredths: number | null;
  perfectCalls: number | null;
};

type Accumulator = {
  played: number;
  calls: number;
  slots: number;
  fp: number;
  eyeqSum: number;
  eyeqBoards: number;
  perfect: number;
  perfectBoards: number;
};

const byProfileId = (a: { universalProfileId: string }, b: { universalProfileId: string }) =>
  a.universalProfileId < b.universalProfileId ? -1 : a.universalProfileId > b.universalProfileId ? 1 : 0;

/**
 * Aggregates graded boards (already restricted to the scope's graded weeks)
 * into ranked rows. Overall pools every position; a position filter keeps
 * only that position's boards.
 */
export function aggregateWaiverLeaderboard(
  boards: ReadonlyArray<WaiverGradedBoard>,
  position: WaiverLeaderboardPosition = "ALL",
): WaiverLeaderboardRow[] {
  const byProfile = new Map<string, Accumulator>();
  for (const board of boards) {
    if (position !== "ALL" && board.position !== position) continue;
    const acc =
      byProfile.get(board.universalProfileId) ??
      { played: 0, calls: 0, slots: 0, fp: 0, eyeqSum: 0, eyeqBoards: 0, perfect: 0, perfectBoards: 0 };
    acc.played += 1;
    acc.calls += board.callsMade;
    acc.slots += board.availableSlots;
    acc.fp += board.totalFpHundredths;
    if (board.callsMade > 0 && board.eyeqHundredths !== null) {
      acc.eyeqSum += board.eyeqHundredths;
      acc.eyeqBoards += 1;
    }
    if (board.callsMade > 0 && board.perfectCalls !== null) {
      acc.perfect += board.perfectCalls;
      acc.perfectBoards += 1;
    }
    byProfile.set(board.universalProfileId, acc);
  }

  const rows: WaiverLeaderboardRow[] = [...byProfile.entries()].map(([universalProfileId, acc]) => ({
    universalProfileId,
    rank: null,
    played: acc.played,
    calls: acc.calls,
    avgEyeqHundredths: acc.eyeqBoards === 0 ? null : divideRoundHalfAwayFromZero(acc.eyeqSum, acc.eyeqBoards),
    fpPerCallHundredths: acc.calls === 0 ? null : divideRoundHalfAwayFromZero(acc.fp, acc.calls),
    fpPerAvailableSlotHundredths: acc.slots === 0 ? null : divideRoundHalfAwayFromZero(acc.fp, acc.slots),
    perfectCalls: acc.perfectBoards === 0 ? null : acc.perfect,
  }));

  const ranked = rows.filter((row) => row.avgEyeqHundredths !== null);
  const unranked = rows.filter((row) => row.avgEyeqHundredths === null).sort(byProfileId);
  ranked.sort((a, b) => (b.avgEyeqHundredths ?? 0) - (a.avgEyeqHundredths ?? 0) || byProfileId(a, b));
  ranked.forEach((row, index) => {
    const previous = ranked[index - 1];
    row.rank = previous && previous.avgEyeqHundredths === row.avgEyeqHundredths ? previous.rank : index + 1;
  });
  return [...ranked, ...unranked];
}

/** "72.4" from integer hundredths; N/A stays N/A. */
export function formatWaiverHundredths(value: number | null): string {
  return value === null ? "N/A" : (value / 100).toFixed(1);
}

export type WaiverMetricKey = "avgEyeq" | "fpPerCall" | "fpPerSlot" | "perfect" | "calls" | "played";

/** Mobile: row 1 Avg Waiver EyeQ / FP per Call / FP per Slot, row 2 Perfect / Calls / Played. */
export const WAIVER_METRIC_ORDER: ReadonlyArray<{ key: WaiverMetricKey; label: string; title?: string }> = [
  { key: "avgEyeq", label: "Avg WaiverEyeQ" },
  { key: "fpPerCall", label: "FP / Call", title: "Fantasy points per submitted call" },
  { key: "fpPerSlot", label: "FP / Slot", title: "Fantasy points per available slot (zero-call boards count 0.0)" },
  { key: "perfect", label: "Perfect", title: "Calls that landed in their exact slot" },
  { key: "calls", label: "Calls" },
  { key: "played", label: "Played" },
];

export function waiverMetricValue(row: WaiverLeaderboardRow, key: WaiverMetricKey): string {
  switch (key) {
    case "avgEyeq":
      return formatWaiverHundredths(row.avgEyeqHundredths);
    case "fpPerCall":
      return formatWaiverHundredths(row.fpPerCallHundredths);
    case "fpPerSlot":
      return formatWaiverHundredths(row.fpPerAvailableSlotHundredths);
    case "perfect":
      return row.perfectCalls === null ? "N/A" : String(row.perfectCalls);
    case "calls":
      return String(row.calls);
    case "played":
      return String(row.played);
  }
}

/** A week counts as an official Waivers competition only once it has Waiver contests. */
export type WaiverLeaderboardWeek = {
  id: string;
  weekNumber: number;
  label: string;
  isTest: boolean;
  contests: ReadonlyArray<{ id: string; position: WaiverPosition; locksAt: Date }>;
};

export function waiverLeaderboardWeekOptions<T extends WaiverLeaderboardWeek>(weeks: ReadonlyArray<T>): T[] {
  return weeks.filter((week) => !week.isTest && week.contests.length > 0).sort((a, b) => a.weekNumber - b.weekNumber);
}

/** The first official Waivers week of the season (2026: Week 5). */
export function inauguralWaiverWeek<T extends WaiverLeaderboardWeek>(options: ReadonlyArray<T>): T | null {
  return options[0] ?? null;
}

/** Requested week if official, else the latest graded week, else the latest official week. */
export function resolveWaiverLeaderboardWeek<T extends WaiverLeaderboardWeek>(input: {
  options: ReadonlyArray<T>;
  requestedWeekNumber: number | null;
  gradedWeekIds: ReadonlySet<string>;
}): T | null {
  const { options } = input;
  const requested = options.find((week) => week.weekNumber === input.requestedWeekNumber);
  if (requested) return requested;
  const graded = options.filter((week) => input.gradedWeekIds.has(week.id));
  return graded[graded.length - 1] ?? options[options.length - 1] ?? null;
}

/** Earliest lock among the week's contests in scope (all positions share one lock in V1). */
export function waiverWeekLocksAt(week: WaiverLeaderboardWeek, position: WaiverLeaderboardPosition): Date | null {
  const contests = week.contests.filter((contest) => position === "ALL" || contest.position === position);
  if (contests.length === 0) return null;
  return new Date(Math.min(...contests.map((contest) => contest.locksAt.getTime())));
}

export type WaiverLeaderboardState =
  | { kind: "NO_WAIVERS_WEEKS" }
  | { kind: "NO_CONTEST"; weekLabel: string }
  | { kind: "LIVE"; weekLabel: string; locksAt: Date }
  | { kind: "PENDING_GRADING"; weekLabel: string }
  | { kind: "SEASON_PENDING"; inauguralWeekLabel: string | null }
  | { kind: "GRADED" };

/**
 * Truthful board state: rows only for graded scope; never zeros for ungraded
 * weeks. Nothing derived from individual boards (not even a count) is exposed
 * before grading.
 */
export function waiverLeaderboardState(input: {
  scope: WaiverLeaderboardScope;
  position: WaiverLeaderboardPosition;
  options: ReadonlyArray<WaiverLeaderboardWeek>;
  week: WaiverLeaderboardWeek | null;
  gradedWeekIds: ReadonlySet<string>;
  now: Date;
}): WaiverLeaderboardState {
  if (input.options.length === 0) return { kind: "NO_WAIVERS_WEEKS" };
  if (input.scope === "season") {
    return input.options.some((week) => input.gradedWeekIds.has(week.id))
      ? { kind: "GRADED" }
      : { kind: "SEASON_PENDING", inauguralWeekLabel: inauguralWaiverWeek(input.options)?.label ?? null };
  }
  const week = input.week;
  if (!week) return { kind: "NO_WAIVERS_WEEKS" };
  if (input.gradedWeekIds.has(week.id)) return { kind: "GRADED" };
  const locksAt = waiverWeekLocksAt(week, input.position);
  if (!locksAt) return { kind: "NO_CONTEST", weekLabel: week.label };
  if (input.now.getTime() < locksAt.getTime()) return { kind: "LIVE", weekLabel: week.label, locksAt };
  return { kind: "PENDING_GRADING", weekLabel: week.label };
}

export function waiverLeaderboardEmptyCopy(
  state: Exclude<WaiverLeaderboardState, { kind: "GRADED" }>,
  lockLabel: string | null,
): { title: string; description: string } {
  switch (state.kind) {
    case "NO_WAIVERS_WEEKS":
      return { title: "No Waivers competitions yet", description: "Waivers standings appear here once an official Waivers week is graded." };
    case "NO_CONTEST":
      return { title: `No ${state.weekLabel} Waivers contest at this position`, description: "This position had no eligible Waivers pool this week." };
    case "LIVE":
      return {
        title: `${state.weekLabel} Waivers is live`,
        description: `Boards lock ${lockLabel ?? "at the posted lock time"}. ${state.weekLabel} Waivers results will appear here after grading.`,
      };
    case "PENDING_GRADING":
      return {
        title: `${state.weekLabel} Waivers results will appear here after grading`,
        description: "Boards are locked. Waiver EyeQ and standings are not shown until the week is graded.",
      };
    case "SEASON_PENDING":
      return {
        title: "Season Waivers standings appear after the first graded week",
        description: `${state.inauguralWeekLabel ?? "The first official week"} is the first Waivers competition of the season. Season standings include graded Waivers weeks only.`,
      };
  }
}
