import type { ContestPosition, WaiverEligibility, WaiverEvidenceRole } from "@/lib/generated/prisma/client";
import { effectiveMaxCalls } from "@/lib/waivers/board-shape";
import { WAIVER_MAX_CALLS, WAIVER_POSITIONS, type WaiverPosition } from "@/lib/waivers/constants";

export type WaiverPoolPlayer = { rankableEntryId: string; name: string; position: ContestPosition };

export type WaiverTrackedPlayer = WaiverPoolPlayer & { lastObservedBps: number; lastObservedWeekNumber: number };

export type WaiverCompletenessEntry = {
  rankableEntryId: string;
  position: ContestPosition;
  evidenceRole: WaiverEvidenceRole;
  eligibility: WaiverEligibility;
};

export type WaiverPositionEvidence = {
  position: WaiverPosition;
  rankingsPoolCount: number;
  rankingsPoolObserved: number;
  rankingsPoolUnobserved: number;
  /** floor(observed × 10000 / pool) — display share in basis points; null for an empty pool. */
  rankingsPoolObservedBps: number | null;
  rankingsPoolUnobservedBps: number | null;
  candidateRows: number;
  followUpRows: number;
  eligible: number;
  excluded: number;
  maxCalls: number;
  effectiveMaxCalls: number;
};

/**
 * Raw completeness evidence (no numeric thresholds): Rankings-pool coverage,
 * previous-week continuity, tracked follow-up gaps, and eligible depth.
 */
export type WaiverCompletenessEvidence = {
  byPosition: WaiverPositionEvidence[];
  unobservedRankingsPlayers: WaiverPoolPlayer[];
  previousWeekNumber: number | null;
  previousWeekEligibleMissing: WaiverPoolPlayer[];
  trackedMissing: WaiverTrackedPlayer[];
};

const byPositionThenId = (a: WaiverPoolPlayer, b: WaiverPoolPlayer) =>
  WAIVER_POSITIONS.indexOf(a.position as WaiverPosition) - WAIVER_POSITIONS.indexOf(b.position as WaiverPosition) ||
  (a.rankableEntryId < b.rankableEntryId ? -1 : a.rankableEntryId > b.rankableEntryId ? 1 : 0);

const share = (part: number, total: number) => (total === 0 ? null : Math.floor((part * 10_000) / total));

export function computeWaiverCompleteness(input: {
  entries: ReadonlyArray<WaiverCompletenessEntry>;
  rankingsPool: ReadonlyArray<WaiverPoolPlayer>;
  previousWeekNumber: number | null;
  previousEligible: ReadonlyArray<WaiverPoolPlayer>;
  tracked: ReadonlyArray<WaiverTrackedPlayer>;
}): WaiverCompletenessEvidence {
  const observed = new Set(input.entries.map((entry) => entry.rankableEntryId));
  const byPosition = WAIVER_POSITIONS.map((position): WaiverPositionEvidence => {
    const pool = input.rankingsPool.filter((player) => player.position === position);
    const poolObserved = pool.filter((player) => observed.has(player.rankableEntryId)).length;
    const rows = input.entries.filter((entry) => entry.position === position);
    const candidates = rows.filter((entry) => entry.evidenceRole === "CANDIDATE");
    const eligible = candidates.filter((entry) => entry.eligibility === "ELIGIBLE").length;
    return {
      position,
      rankingsPoolCount: pool.length,
      rankingsPoolObserved: poolObserved,
      rankingsPoolUnobserved: pool.length - poolObserved,
      rankingsPoolObservedBps: share(poolObserved, pool.length),
      rankingsPoolUnobservedBps: share(pool.length - poolObserved, pool.length),
      candidateRows: candidates.length,
      followUpRows: rows.length - candidates.length,
      eligible,
      excluded: candidates.filter((entry) => entry.eligibility === "EXCLUDED").length,
      maxCalls: WAIVER_MAX_CALLS[position],
      effectiveMaxCalls: effectiveMaxCalls(WAIVER_MAX_CALLS[position], eligible),
    };
  });
  return {
    byPosition,
    unobservedRankingsPlayers: input.rankingsPool.filter((player) => !observed.has(player.rankableEntryId)).sort(byPositionThenId),
    previousWeekNumber: input.previousWeekNumber,
    previousWeekEligibleMissing: input.previousEligible.filter((player) => !observed.has(player.rankableEntryId)).sort(byPositionThenId),
    trackedMissing: input.tracked.filter((player) => !observed.has(player.rankableEntryId)).sort(byPositionThenId),
  };
}
