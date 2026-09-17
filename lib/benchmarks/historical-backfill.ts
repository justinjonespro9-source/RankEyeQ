/**
 * Admin Historical / Backfill Entry eligibility.
 *
 * Backfill Mode only overrides DATA ENTRY locks.
 * Official competitive eligibility always uses the historical source timestamp
 * (sourcePublishedAt), never wall-clock admin transcription time.
 */
import { isLateCapture } from "@/lib/benchmarks/merge";

export const HISTORICAL_BACKFILL_HELP =
  "Use this to record a ranking that was published before its lock but is being entered into RankEyeQ later.";

export const HISTORICAL_BACKFILL_BADGE = "BACKFILLED";

export const HISTORICAL_SOURCE_REQUIRED =
  "Historical / Backfill Entry requires Source published at (America/Chicago).";

export const HISTORICAL_LATE_WARNING =
  "Historical source time is after Week.fullLockAt — stored as tracking-only, not eligible for official scoring or pregame consensus.";

export const HISTORICAL_OFFICIAL_NOTICE =
  "Historical / Backfill Entry: official eligibility uses Source published at. Frozen consensus snapshots are not rewritten automatically.";

export type HistoricalCompetitiveClockInput = {
  historicalBackfill: boolean;
  /** When the ranking was actually published/captured externally. */
  sourcePublishedAt: Date | null | undefined;
  /** Wall-clock admin transcription / capture time. */
  capturedAt: Date;
};

/**
 * Competitive timestamp for lock / consensus / grading eligibility.
 * Backfill requires sourcePublishedAt; ordinary captures use capturedAt.
 */
export function competitiveCaptureTimestamp(
  input: HistoricalCompetitiveClockInput,
): Date {
  if (input.historicalBackfill) {
    if (!input.sourcePublishedAt) {
      throw new Error(HISTORICAL_SOURCE_REQUIRED);
    }
    return input.sourcePublishedAt;
  }
  return input.capturedAt;
}

/** True when the competitive clock is at/after Week.fullLockAt. */
export function isCompetitivelyLate(
  competitiveAt: Date,
  fullLockAt: Date | null | undefined,
): boolean {
  return isLateCapture(competitiveAt, fullLockAt);
}

export function historicalBackfillAuditFlags(input: {
  historicalBackfill: boolean;
  wallClockNow: Date;
  fullLockAt: Date | null | undefined;
  weekStatus: string;
}): {
  historicalBackfill: boolean;
  backfilledAt: Date | null;
  enteredAfterFullLock: boolean;
  enteredAfterWeekComplete: boolean;
} {
  if (!input.historicalBackfill) {
    return {
      historicalBackfill: false,
      backfilledAt: null,
      enteredAfterFullLock: false,
      enteredAfterWeekComplete: false,
    };
  }
  return {
    historicalBackfill: true,
    backfilledAt: input.wallClockNow,
    enteredAfterFullLock: isLateCapture(input.wallClockNow, input.fullLockAt),
    enteredAfterWeekComplete: input.weekStatus === "COMPLETE",
  };
}

/**
 * Official (gradeable / consensus-eligible) when competitively on-time.
 * Tracking-only when source/competitive timestamp is after full lock.
 */
export function isOfficiallyCompetitiveBackfill(input: {
  historicalBackfill: boolean;
  sourcePublishedAt: Date | null | undefined;
  capturedAt: Date;
  fullLockAt: Date | null | undefined;
}): boolean {
  const competitiveAt = competitiveCaptureTimestamp({
    historicalBackfill: input.historicalBackfill,
    sourcePublishedAt: input.sourcePublishedAt,
    capturedAt: input.capturedAt,
  });
  return !isCompetitivelyLate(competitiveAt, input.fullLockAt);
}
