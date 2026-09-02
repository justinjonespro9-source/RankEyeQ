import {
  RANKIQ_TIMEZONE,
  addCalendarDays,
  chicagoCalendarDate,
  chicagoWeekday,
  zonedLocalToUtc,
} from "@/lib/timing/chicago";

export type WeekTimingWindows = {
  rankingsOpenAt: Date;
  fullLockAt: Date;
  revealStartsAt: Date;
  publicReleaseAt: Date;
  timeZone: typeof RANKIQ_TIMEZONE;
};

type ChicagoWeekday = "Sun" | "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat";

function weekdayOfChicagoDate(year: number, month: number, day: number) {
  return chicagoWeekday(zonedLocalToUtc(year, month, day, 12, 0));
}

function findWeekdayOnOrBefore(
  year: number,
  month: number,
  day: number,
  target: ChicagoWeekday,
) {
  let cursor = { year, month, day };
  for (let i = 0; i < 8; i += 1) {
    if (weekdayOfChicagoDate(cursor.year, cursor.month, cursor.day) === target) {
      return cursor;
    }
    cursor = addCalendarDays(cursor.year, cursor.month, cursor.day, -1);
  }
  throw new Error(`Could not find ${target} on or before date`);
}

function findWeekdayOnOrAfter(
  year: number,
  month: number,
  day: number,
  target: ChicagoWeekday,
) {
  let cursor = { year, month, day };
  for (let i = 0; i < 8; i += 1) {
    if (weekdayOfChicagoDate(cursor.year, cursor.month, cursor.day) === target) {
      return cursor;
    }
    cursor = addCalendarDays(cursor.year, cursor.month, cursor.day, 1);
  }
  throw new Error(`Could not find ${target} on or after date`);
}

/**
 * NFL RankIQ defaults from the week’s first/last game instants:
 * - Open: Tuesday 12:00 AM America/Chicago on or before first kickoff
 * - Full lock / reveal start: Sunday 10:00 AM America/Chicago
 * - Public release: Sunday 12:00 PM America/Chicago (noon slate)
 */
export function computeNflTimingWindows(
  firstKickoff: Date,
  lastKickoff?: Date,
): WeekTimingWindows {
  const first = chicagoCalendarDate(firstKickoff);
  const tuesday = findWeekdayOnOrBefore(first.year, first.month, first.day, "Tue");
  const sunday = findWeekdayOnOrAfter(first.year, first.month, first.day, "Sun");

  if (lastKickoff) {
    const last = chicagoCalendarDate(lastKickoff);
    const sundayFromEnd = findWeekdayOnOrBefore(
      last.year,
      last.month,
      last.day,
      "Sun",
    );
    // Prefer Sunday that falls inside the game window when first kickoff is after Sunday.
    if (
      weekdayOfChicagoDate(first.year, first.month, first.day) === "Mon" ||
      weekdayOfChicagoDate(first.year, first.month, first.day) === "Sun"
    ) {
      return buildWindows(tuesday, sundayFromEnd);
    }
  }

  return buildWindows(tuesday, sunday);
}

function buildWindows(
  tuesday: { year: number; month: number; day: number },
  sunday: { year: number; month: number; day: number },
): WeekTimingWindows {
  const rankingsOpenAt = zonedLocalToUtc(
    tuesday.year,
    tuesday.month,
    tuesday.day,
    0,
    0,
  );
  const fullLockAt = zonedLocalToUtc(
    sunday.year,
    sunday.month,
    sunday.day,
    10,
    0,
  );
  const publicReleaseAt = zonedLocalToUtc(
    sunday.year,
    sunday.month,
    sunday.day,
    12,
    0,
  );

  return {
    rankingsOpenAt,
    fullLockAt,
    revealStartsAt: fullLockAt,
    publicReleaseAt,
    timeZone: RANKIQ_TIMEZONE,
  };
}

export type WeekTimingPhase =
  | "upcoming"
  | "open"
  | "partial-lock"
  | "full-lock"
  | "reveal"
  | "public"
  | "complete";

export type WeekTimingState = {
  phase: WeekTimingPhase;
  rankingsOpenAt: Date | null;
  fullLockAt: Date | null;
  revealStartsAt: Date | null;
  publicReleaseAt: Date | null;
  canEditUnlocked: boolean;
  fullBoardLocked: boolean;
  consensusVisible: boolean;
  boardsPublic: boolean;
  revealWindowActive: boolean;
};

export function getWeekTimingState(input: {
  rankingsOpenAt?: Date | null;
  fullLockAt?: Date | null;
  revealStartsAt?: Date | null;
  publicReleaseAt?: Date | null;
  weekStatus?: string | null;
  now?: Date;
  anyKickoffStarted?: boolean;
}): WeekTimingState {
  const now = input.now ?? new Date();
  const rankingsOpenAt = input.rankingsOpenAt ?? null;
  const fullLockAt = input.fullLockAt ?? null;
  const revealStartsAt = input.revealStartsAt ?? fullLockAt;
  const publicReleaseAt = input.publicReleaseAt ?? null;
  const complete =
    input.weekStatus === "COMPLETE" || input.weekStatus === "ARCHIVED";

  const boardsPublic =
    complete || Boolean(publicReleaseAt && now >= publicReleaseAt);
  const fullBoardLocked =
    complete || Boolean(fullLockAt && now >= fullLockAt);
  const revealWindowActive = Boolean(
    !boardsPublic &&
      revealStartsAt &&
      publicReleaseAt &&
      now >= revealStartsAt &&
      now < publicReleaseAt,
  );
  const consensusVisible = fullBoardLocked || boardsPublic;
  const afterOpen = !rankingsOpenAt || now >= rankingsOpenAt;
  const canEditUnlocked = afterOpen && !fullBoardLocked && !complete;

  let phase: WeekTimingPhase = "upcoming";
  if (complete || boardsPublic) phase = complete ? "complete" : "public";
  else if (revealWindowActive) phase = "reveal";
  else if (fullBoardLocked) phase = "full-lock";
  else if (afterOpen && input.anyKickoffStarted) phase = "partial-lock";
  else if (afterOpen) phase = "open";

  return {
    phase,
    rankingsOpenAt,
    fullLockAt,
    revealStartsAt,
    publicReleaseAt,
    canEditUnlocked,
    fullBoardLocked,
    consensusVisible,
    boardsPublic,
    revealWindowActive,
  };
}
