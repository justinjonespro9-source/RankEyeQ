import {
  addCalendarDays,
  chicagoCalendarDate,
  chicagoWeekday,
  zonedLocalToUtc,
} from "@/lib/timing/chicago";

/** V1 Waiver lock: Tuesday 7:00 PM America/Chicago. */
export const WAIVER_LOCK_WEEKDAY = "Tue";
export const WAIVER_LOCK_HOUR_CHICAGO = 19;

type CalendarDate = { year: number; month: number; day: number };

function chicagoTuesdayOnOrBefore(date: CalendarDate): CalendarDate {
  let cursor = date;
  for (let i = 0; i < 7; i += 1) {
    const noon = zonedLocalToUtc(cursor.year, cursor.month, cursor.day, 12, 0);
    if (chicagoWeekday(noon) === WAIVER_LOCK_WEEKDAY) return cursor;
    cursor = addCalendarDays(cursor.year, cursor.month, cursor.day, -1);
  }
  throw new Error("No Tuesday within the preceding week");
}

/** Tuesday 7:00 PM America/Chicago on or before the Chicago date of `firstKickoff`. */
export function computeWaiverLocksAt(firstKickoff: Date): Date {
  if (Number.isNaN(firstKickoff.getTime())) throw new RangeError("Invalid first kickoff");
  const tuesday = chicagoTuesdayOnOrBefore(chicagoCalendarDate(firstKickoff));
  return zonedLocalToUtc(tuesday.year, tuesday.month, tuesday.day, WAIVER_LOCK_HOUR_CHICAGO, 0);
}

/**
 * Approved one-off lock instants keyed by Week id. Every other week uses the
 * Tuesday 7:00 PM CT default. A contest's locksAt is immutable once opened, so
 * an entry only affects contests opened after it ships.
 */
export const WAIVER_LOCK_OVERRIDES: Readonly<Record<string, string>> = {
  // 2026 Week 5 — inaugural Production launch, extended to Tue Oct 6 10:00 PM CDT.
  cmurulv5d000006p0zghkgky7: "2026-10-07T03:00:00.000Z",
};

export type WaiverLockResolution =
  | { ok: true; locksAt: Date }
  | { ok: false; reason: "LOCK_NOT_BEFORE_FIRST_KICKOFF"; locksAt: Date };

/** Week lock (override, else the V1 default); it must fall strictly before the week's first kickoff. */
export function resolveWaiverLocksAt(firstKickoff: Date, weekId?: string): WaiverLockResolution {
  const override = weekId ? WAIVER_LOCK_OVERRIDES[weekId] : undefined;
  const locksAt = override ? new Date(override) : computeWaiverLocksAt(firstKickoff);
  if (locksAt.getTime() >= firstKickoff.getTime()) {
    return { ok: false, reason: "LOCK_NOT_BEFORE_FIRST_KICKOFF", locksAt };
  }
  return { ok: true, locksAt };
}

export type WaiverOpeningWindowError =
  | "OBSERVED_AFTER_FROZEN"
  | "FROZEN_AFTER_OPEN"
  | "OPEN_NOT_BEFORE_LOCK"
  | "LOCK_NOT_BEFORE_FIRST_KICKOFF";

/** Required ordering: observedAt ≤ frozenAt ≤ opensAt < locksAt < first kickoff. */
export function validateWaiverOpeningWindow(input: {
  observedAt: Date;
  frozenAt: Date;
  opensAt: Date;
  locksAt: Date;
  firstKickoff: Date;
}): WaiverOpeningWindowError[] {
  const errors: WaiverOpeningWindowError[] = [];
  if (input.observedAt.getTime() > input.frozenAt.getTime()) errors.push("OBSERVED_AFTER_FROZEN");
  if (input.frozenAt.getTime() > input.opensAt.getTime()) errors.push("FROZEN_AFTER_OPEN");
  if (input.opensAt.getTime() >= input.locksAt.getTime()) errors.push("OPEN_NOT_BEFORE_LOCK");
  if (input.locksAt.getTime() >= input.firstKickoff.getTime()) errors.push("LOCK_NOT_BEFORE_FIRST_KICKOFF");
  return errors;
}

export type WaiverPhase = "OPEN" | "LOCKED";

/** Effective phase from the authoritative clock. Stored status never reopens a lock. */
export function waiverPhaseAt(locksAt: Date, now: Date): WaiverPhase {
  return now.getTime() >= locksAt.getTime() ? "LOCKED" : "OPEN";
}

export function isWaiverLocked(locksAt: Date, now: Date): boolean {
  return waiverPhaseAt(locksAt, now) === "LOCKED";
}

/** Reveal is derivable from the clock alone: revealAt = locksAt. */
export function isWaiverRevealAllowed(locksAt: Date, now: Date): boolean {
  return isWaiverLocked(locksAt, now);
}
