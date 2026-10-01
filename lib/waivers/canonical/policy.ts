import type { WaiverCanonicalClass } from "@/lib/waivers/canonical/disposition";
import { canonicalExportChecksum } from "@/lib/waivers/canonical/serialization";
import { rankEyeQTeamForSngTeamKey, sngTeamForRankEyeQTeam } from "@/lib/waivers/canonical/team-crosswalk";
import { computeWaiverProduction } from "@/lib/waivers/production";
import { rankWaiverPool } from "@/lib/waivers/ranking";
import { maxRawPointsForSlot, scoreWaiverCall, waiverEyeqHundredths, WaiverScoringError } from "@/lib/waivers/scoring";

/**
 * Pure policy helpers for the approved canonical treatments. They evaluate
 * supplied inputs only; nothing here loads, grades or persists a contest.
 *
 *   D1  VERIFIED_NON_PARTICIPANT (DNP / NO_ROSTER_ASSIGNMENT): call stands,
 *       0 raw points, 0 FP, stays in coverage and both FP denominators, no
 *       exact/honor credit for the slot, no local Waiver rank.
 *   C2  Pre-lock invalidated call left unrevised: identical accounting to D1.
 *   D2  CANCELLED_GAME / MOVED_OUT_OF_WEEK: call and slot neutralized from
 *       earned/max, FP/Call and FP/Available Slot; no compaction.
 *   D3  Snapshot/canonical contradiction (including TEAM_CHANGED) blocks until
 *       an exceptional, audited operator resolution; never automatic.
 *
 * Precedence over C2: only neutralization supersedes a pre-lock invalidation,
 * either systemic D2 or an explicit audited D3 NEUTRALIZED resolution. The
 * invalidation stays recorded. Any other D3 resolution unblocks the call but
 * C2 still scores it.
 *
 * Honors: a neutralized call is not a miss, but it never completes a
 * full-board honor (Perfect Podium / Perfect Five).
 */

/** Audit fields a D3 resolution carries; they travel with the resolved treatment. */
type OperatorResolved = { operatorResolutions?: readonly SnapshotCanonicalConflictResolution[] };

export type CanonicalNeutralizationPrecedence = "D2_NEUTRALIZATION_OVER_C2_INVALIDATION" | "D3_NEUTRALIZATION_OVER_C2_INVALIDATION";

export type CanonicalCallTreatment =
  | ({ kind: "RANKED"; waiverPoolRank: number; fpHundredths: number } & OperatorResolved)
  | ({ kind: "NON_PARTICIPANT_ZERO"; reason: string } & OperatorResolved)
  | ({ kind: "INVALIDATED_PRE_LOCK" } & OperatorResolved)
  | ({ kind: "NEUTRALIZED"; reason: string } & ({ invalidatedPreLock?: never; precedence?: never } | { invalidatedPreLock: true; precedence: CanonicalNeutralizationPrecedence }) & OperatorResolved)
  | { kind: "BLOCKED"; code: CanonicalPolicyBlockCode; detail: string };

export type CanonicalPolicyBlockCode = "SNAPSHOT_CANONICAL_CONFLICT" | "CANONICAL_RESULT_BLOCKED" | "CANONICAL_RESULT_MISSING";

// ---------------------------------------------------------------------------
// Frozen-pool ranking (snapshot pool membership; canonical points)
// ---------------------------------------------------------------------------

export type FrozenPoolCanonicalRow = { snapshotEntryId: string; cls: WaiverCanonicalClass; fpHundredths: number | null };

/**
 * Shared Waiver Pool Ranks over the frozen pool members SNG ranked. D1/D2/D3
 * members receive no local rank and do not occupy a rank position.
 */
export function rankFrozenPoolFromCanonical(rows: readonly FrozenPoolCanonicalRow[]): Map<string, { waiverPoolRank: number; fpHundredths: number }> {
  const ranked = rows.filter((row) => row.cls === "RANKED");
  for (const row of ranked) {
    if (row.fpHundredths === null || !Number.isSafeInteger(row.fpHundredths)) {
      throw new WaiverScoringError(`Ranked pool member ${row.snapshotEntryId} needs integer canonical points`);
    }
  }
  return new Map(
    rankWaiverPool(ranked, (row) => row.fpHundredths as number).map(({ item, waiverRank, fpHundredths }) => [
      item.snapshotEntryId,
      { waiverPoolRank: waiverRank, fpHundredths },
    ]),
  );
}

// ---------------------------------------------------------------------------
// D3 — snapshot / canonical conflicts
// ---------------------------------------------------------------------------

export type SnapshotCanonicalConflictKind = "BYE_VS_SCHEDULED" | "TEAM_CHANGED";

export type SnapshotCanonicalConflict = {
  code: "SNAPSHOT_CANONICAL_CONFLICT";
  kind: SnapshotCanonicalConflictKind;
  /** Stable for this entry, participant, conflict kind and artifact content. */
  conflictKey: string;
  snapshotEntryId: string;
  participantId: string;
  detail: string;
};

export function detectSnapshotCanonicalConflicts(input: {
  artifactContentChecksum: string;
  snapshotEntryId: string;
  snapshot: { isByeAtFreeze: boolean; teamAtFreeze: string | null };
  canonical: { participantId: string; cls: WaiverCanonicalClass; disposition: string; teamKey: string };
}): SnapshotCanonicalConflict[] {
  const conflicts: SnapshotCanonicalConflict[] = [];
  const push = (kind: SnapshotCanonicalConflictKind, detail: string) =>
    conflicts.push({
      code: "SNAPSHOT_CANONICAL_CONFLICT",
      kind,
      conflictKey: canonicalExportChecksum({
        v: 1,
        kind,
        snapshotEntryId: input.snapshotEntryId,
        participantId: input.canonical.participantId,
        artifactContentChecksum: input.artifactContentChecksum,
      }),
      snapshotEntryId: input.snapshotEntryId,
      participantId: input.canonical.participantId,
      detail,
    });
  if (input.canonical.cls === "SNAPSHOT_CONFLICT" && !input.snapshot.isByeAtFreeze) {
    push("BYE_VS_SCHEDULED", "frozen snapshot recorded a scheduled game; canonical evidence says BYE");
  }
  const teamComparable = input.canonical.cls === "RANKED" || input.canonical.disposition === "DNP";
  const frozenTeam = input.snapshot.teamAtFreeze === null ? null : sngTeamForRankEyeQTeam(input.snapshot.teamAtFreeze);
  if (teamComparable && frozenTeam && frozenTeam.sngTeamKey !== input.canonical.teamKey) {
    const canonicalTeam = rankEyeQTeamForSngTeamKey(input.canonical.teamKey)?.rankeyeqTeam ?? input.canonical.teamKey;
    push("TEAM_CHANGED", `frozen team ${input.snapshot.teamAtFreeze}; canonical team ${canonicalTeam}`);
  }
  return conflicts;
}

export const CONFLICT_RESOLUTIONS = ["SCORE_AS_RANKED", "NON_PARTICIPANT_ZERO", "NEUTRALIZED"] as const;
export type ConflictResolutionTreatment = (typeof CONFLICT_RESOLUTIONS)[number];

/** An exceptional operator decision for one D3 conflict (modeled only; never persisted in Stage 4A). */
export type SnapshotCanonicalConflictResolution = {
  conflictKey: string;
  conflictKind: SnapshotCanonicalConflictKind;
  resolution: ConflictResolutionTreatment;
  resolvedByUserId: string;
  /** ISO-8601 UTC instant, e.g. 2026-10-06T15:04:05.000Z. */
  resolvedAt: string;
  reason: string;
};

const isUtcInstant = (value: string) => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
};

export function validConflictResolution(conflict: SnapshotCanonicalConflict, resolution: SnapshotCanonicalConflictResolution | undefined): boolean {
  return (
    resolution !== undefined &&
    resolution.conflictKey === conflict.conflictKey &&
    resolution.conflictKind === conflict.kind &&
    (CONFLICT_RESOLUTIONS as readonly string[]).includes(resolution.resolution) &&
    resolution.resolvedByUserId.trim().length > 0 &&
    isUtcInstant(resolution.resolvedAt) &&
    resolution.reason.trim().length > 0
  );
}

// ---------------------------------------------------------------------------
// Per-call treatment
// ---------------------------------------------------------------------------

export function resolveCanonicalCallTreatment(input: {
  /** null when the called player has no canonical result (never automatic zero). */
  cls: WaiverCanonicalClass | null;
  reason: string;
  ranked: { waiverPoolRank: number; fpHundredths: number } | null;
  invalidatedPreLock: boolean;
  conflicts: readonly SnapshotCanonicalConflict[];
  resolutions: readonly SnapshotCanonicalConflictResolution[];
}): CanonicalCallTreatment {
  if (input.cls === null) return { kind: "BLOCKED", code: "CANONICAL_RESULT_MISSING", detail: "no canonical result; a missing row is never zero" };
  if (input.cls === "BLOCKED") return { kind: "BLOCKED", code: "CANONICAL_RESULT_BLOCKED", detail: input.reason };

  const resolutions = new Map(input.resolutions.map((r) => [r.conflictKey, r]));
  const unresolved = input.conflicts.filter((conflict) => !validConflictResolution(conflict, resolutions.get(conflict.conflictKey)));
  if (unresolved.length > 0) {
    return { kind: "BLOCKED", code: "SNAPSHOT_CANONICAL_CONFLICT", detail: unresolved.map((c) => c.detail).join("; ") };
  }
  if (input.cls === "SNAPSHOT_CONFLICT" && input.conflicts.length === 0) {
    return { kind: "BLOCKED", code: "SNAPSHOT_CANONICAL_CONFLICT", detail: input.reason };
  }
  const applied = input.conflicts.map((c) => resolutions.get(c.conflictKey)!);
  const chosen = new Set(applied.map((r) => r.resolution));
  if (chosen.size > 1) {
    return { kind: "BLOCKED", code: "SNAPSHOT_CANONICAL_CONFLICT", detail: "conflict resolutions disagree on the treatment" };
  }
  const resolved = chosen.size === 1 ? [...chosen][0] : null;
  const audited = <T extends Exclude<CanonicalCallTreatment, { kind: "BLOCKED" }>>(treatment: T): T =>
    applied.length > 0 ? { ...treatment, operatorResolutions: applied } : treatment;

  if (input.invalidatedPreLock) {
    if (input.cls === "SYSTEMIC_NEUTRALIZE") {
      return audited({ kind: "NEUTRALIZED", reason: input.reason, invalidatedPreLock: true, precedence: "D2_NEUTRALIZATION_OVER_C2_INVALIDATION" });
    }
    if (resolved === "NEUTRALIZED") {
      return audited({ kind: "NEUTRALIZED", reason: "operator-resolved conflict", invalidatedPreLock: true, precedence: "D3_NEUTRALIZATION_OVER_C2_INVALIDATION" });
    }
    return audited({ kind: "INVALIDATED_PRE_LOCK" });
  }
  if (resolved === "NON_PARTICIPANT_ZERO") return audited({ kind: "NON_PARTICIPANT_ZERO", reason: "operator-resolved conflict" });
  if (resolved === "NEUTRALIZED") return audited({ kind: "NEUTRALIZED", reason: "operator-resolved conflict" });
  if (resolved === "SCORE_AS_RANKED" && input.cls !== "RANKED") {
    return { kind: "BLOCKED", code: "SNAPSHOT_CANONICAL_CONFLICT", detail: "SCORE_AS_RANKED requires a ranked canonical result" };
  }

  switch (input.cls) {
    case "RANKED":
      if (!input.ranked) return { kind: "BLOCKED", code: "CANONICAL_RESULT_BLOCKED", detail: "ranked result lacks a Waiver pool rank" };
      return audited({ kind: "RANKED", waiverPoolRank: input.ranked.waiverPoolRank, fpHundredths: input.ranked.fpHundredths });
    case "NON_PARTICIPANT":
      return audited({ kind: "NON_PARTICIPANT_ZERO", reason: input.reason });
    case "SYSTEMIC_NEUTRALIZE":
      return audited({ kind: "NEUTRALIZED", reason: input.reason });
    case "SNAPSHOT_CONFLICT":
      return { kind: "BLOCKED", code: "SNAPSHOT_CANONICAL_CONFLICT", detail: input.reason };
  }
}

// ---------------------------------------------------------------------------
// Board evaluation under the approved treatments
// ---------------------------------------------------------------------------

export type CanonicalBoardCall = { slot: number; treatment: CanonicalCallTreatment };

export type EvaluatedCanonicalCall = {
  slot: number;
  treatment: CanonicalCallTreatment["kind"];
  /** False only for neutralized calls (removed from scoring; not a miss). */
  scored: boolean;
  rawPoints: number | null;
  fpHundredths: number | null;
  exactSlotHit: boolean;
  /** Slot-level exact/honor credit: only ranked calls; never D1, C2 or neutralized calls. */
  honorCreditEligible: boolean;
  /** The call was invalidated before lock (C2), whether or not a neutralization later took precedence. */
  invalidatedPreLock: boolean;
  precedence: CanonicalNeutralizationPrecedence | null;
  operatorResolutions: readonly SnapshotCanonicalConflictResolution[];
};

export type CanonicalPerfectHonor = "PERFECT_CALL" | "PERFECT_PODIUM" | "PERFECT_FIVE";

const FULL_BOARD_HONOR_BY_FIELD_SIZE: Readonly<Record<number, { honor: CanonicalPerfectHonor; slots: number }>> = {
  3: { honor: "PERFECT_PODIUM", slots: 3 },
  5: { honor: "PERFECT_FIVE", slots: 5 },
};

/**
 * At most one perfect honor per board. Perfect Podium (Top-3 boards) and
 * Perfect Five (WR) need every required slot submitted, non-neutralized and
 * exact. Otherwise Perfect Call needs at least one scored call and every scored
 * call exact; neutralized calls are ignored, never counted as misses.
 */
export function canonicalPerfectHonor(calls: readonly EvaluatedCanonicalCall[], resultFieldSize: number): CanonicalPerfectHonor | null {
  const fullBoard = FULL_BOARD_HONOR_BY_FIELD_SIZE[resultFieldSize];
  if (!fullBoard) throw new WaiverScoringError(`No perfect-honor rule for result field size ${resultFieldSize}`);
  const scored = calls.filter((call) => call.scored);
  if (scored.length === 0 || !scored.every((call) => call.exactSlotHit)) return null;
  const fullBoardComplete = Array.from({ length: fullBoard.slots }, (_, i) => calls.find((call) => call.slot === i + 1)).every(
    (call) => call !== undefined && call.scored && call.exactSlotHit,
  );
  return fullBoardComplete ? fullBoard.honor : "PERFECT_CALL";
}

export type CanonicalBoardEvaluation =
  | { status: "BLOCKED"; blockers: Array<{ slot: number; code: CanonicalPolicyBlockCode; detail: string }> }
  | {
      status: "EVALUATED";
      calls: EvaluatedCanonicalCall[];
      submittedCalls: number;
      scoredCalls: number;
      neutralizedSlots: number[];
      availableSlots: number;
      effectiveAvailableSlots: number;
      earnedRawPoints: number;
      maxRawPoints: number;
      /** null = N/A (no calls, or every submitted call neutralized). */
      eyeqHundredths: number | null;
      totalFpHundredths: number;
      fpPerCallHundredths: number | null;
      fpPerAvailableSlotHundredths: number | null;
      allNeutralized: boolean;
      perfectHonor: CanonicalPerfectHonor | null;
    };

export function evaluateCanonicalWaiverBoard(input: {
  calls: readonly CanonicalBoardCall[];
  availableSlots: number;
  resultFieldSize: number;
}): CanonicalBoardEvaluation {
  const { availableSlots, resultFieldSize } = input;
  const calls = [...input.calls].sort((a, b) => a.slot - b.slot);
  if (!Number.isInteger(availableSlots) || availableSlots < 0 || availableSlots > resultFieldSize) {
    throw new WaiverScoringError(`availableSlots ${availableSlots} must be within 0..${resultFieldSize}`);
  }
  if (calls.length > availableSlots) throw new WaiverScoringError(`callsMade ${calls.length} exceeds available slots ${availableSlots}`);
  calls.forEach((call, index) => {
    if (call.slot !== index + 1) throw new WaiverScoringError("Board calls must occupy contiguous slots from 1");
  });

  const blockers = calls.flatMap((call) =>
    call.treatment.kind === "BLOCKED" ? [{ slot: call.slot, code: call.treatment.code, detail: call.treatment.detail }] : [],
  );
  if (blockers.length > 0) return { status: "BLOCKED", blockers };

  const evaluated: EvaluatedCanonicalCall[] = calls.map(({ slot, treatment }) => {
    if (treatment.kind === "BLOCKED") throw new WaiverScoringError("unreachable: blocked calls are returned above");
    const precedence = treatment.kind === "NEUTRALIZED" ? (treatment.precedence ?? null) : null;
    const audit = {
      invalidatedPreLock: treatment.kind === "INVALIDATED_PRE_LOCK" || precedence !== null,
      precedence,
      operatorResolutions: treatment.operatorResolutions ?? [],
    };
    switch (treatment.kind) {
      case "RANKED": {
        const score = scoreWaiverCall(slot, treatment.waiverPoolRank, resultFieldSize);
        return { slot, treatment: treatment.kind, scored: true, rawPoints: score.totalPoints, fpHundredths: treatment.fpHundredths, exactSlotHit: score.exactSlotHit, honorCreditEligible: true, ...audit };
      }
      case "NON_PARTICIPANT_ZERO":
      case "INVALIDATED_PRE_LOCK": {
        const score = scoreWaiverCall(slot, null, resultFieldSize);
        return { slot, treatment: treatment.kind, scored: true, rawPoints: score.totalPoints, fpHundredths: 0, exactSlotHit: false, honorCreditEligible: false, ...audit };
      }
      case "NEUTRALIZED":
        return { slot, treatment: treatment.kind, scored: false, rawPoints: null, fpHundredths: null, exactSlotHit: false, honorCreditEligible: false, ...audit };
    }
  });

  const scored = evaluated.filter((call) => call.scored);
  const neutralizedSlots = evaluated.filter((call) => !call.scored).map((call) => call.slot);
  const effectiveAvailableSlots = availableSlots - neutralizedSlots.length;
  const earnedRawPoints = scored.reduce((sum, call) => sum + (call.rawPoints ?? 0), 0);
  const maxRawPoints = scored.reduce((sum, call) => sum + maxRawPointsForSlot(call.slot, resultFieldSize), 0);
  const allNeutralized = calls.length > 0 && scored.length === 0;
  const production = computeWaiverProduction({
    calls: scored.map((call) => ({ fpHundredths: call.fpHundredths ?? 0 })),
    availableSlots: effectiveAvailableSlots,
  });

  return {
    status: "EVALUATED",
    calls: evaluated,
    submittedCalls: calls.length,
    scoredCalls: scored.length,
    neutralizedSlots,
    availableSlots,
    effectiveAvailableSlots,
    earnedRawPoints,
    maxRawPoints,
    eyeqHundredths:
      scored.length === 0
        ? null
        : waiverEyeqHundredths({ earnedRawPoints, maxRawPoints, callsMade: scored.length, availableSlots: effectiveAvailableSlots }),
    totalFpHundredths: production.totalFpHundredths,
    fpPerCallHundredths: production.fpPerCallHundredths,
    fpPerAvailableSlotHundredths: allNeutralized ? null : production.fpPerAvailableSlotHundredths,
    allNeutralized,
    perfectHonor: canonicalPerfectHonor(evaluated, resultFieldSize),
  };
}
