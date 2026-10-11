import { evaluateCanonicalWaiverBoard, type CanonicalCallTreatment } from "@/lib/waivers/canonical/policy";
import { WAIVER_EYEQ_V1, type WaiverPosition } from "@/lib/waivers/constants";
import type {
  WaiverCallOutcome,
  WaiverCompetitor,
  WaiverGradingBoardGrade,
  WaiverGradingCallGrade,
  WaiverGradingIssue,
  WaiverGradingPoolRow,
} from "@/lib/waivers/grading/model";
import { divideRoundHalfAwayFromZero } from "@/lib/waivers/precision";
import * as fingerprints from "@/lib/waivers/results/fingerprints";
import { deriveWaiverUngradableReason, WAIVER_HONOR_INELIGIBLE_REASONS } from "@/lib/waivers/results/model";
import { maxRawPointsForSlot, waiverEyeqHundredths } from "@/lib/waivers/scoring";

/**
 * WAIVER_EYEQ_V1 for one locked board against its contest result. Every
 * locked SUBMISSION revision is graded the same way, whoever entered it (human,
 * AI, AI late entry or ADMIN_COMPETITIVE_OVERRIDE): the competitor is carried
 * for reporting only.
 *
 *   call:   10 + (N - |slot - waiver pool rank|) inside the configured Top N,
 *           plus the exact podium bonus 20/15/10; 0 outside it; D1/C2 score 0;
 *           neutralized calls leave earned and max (no compaction).
 *   board:  CallQuality = earned / max over scoreable calls; coverage k is
 *           capped at the effective available slots K (= available slots less
 *           neutralized calls); EyeQ = CQ x (0.70 + 0.30 k/K) x 100, rounded
 *           half up to hundredths.
 */

export type WaiverGradingPoolRowRef = Pick<
  WaiverGradingPoolRow,
  | "category"
  | "rankableEntryId"
  | "treatment"
  | "waiverPoolRank"
  | "canonicalPositionRank"
  | "fpHundredths"
  | "neutralizationPrecedence"
  | "conflictResolutionId"
  | "participantDisposition"
  | "rowFingerprint"
>;

export type WaiverGradingContestRef = {
  position: WaiverPosition;
  contestId: string;
  resultFieldSize: number;
  effectiveAvailableSlots: number;
  resultFingerprint: string;
  honorScoreableSlots: number;
  rows: readonly WaiverGradingPoolRowRef[];
};

export type WaiverGradingBoardInput = {
  submissionId: string;
  revisionId: string;
  revisionFingerprint: string;
  revisionKind: string;
  revisionCallCount: number;
  competitor: WaiverCompetitor;
  calls: ReadonlyArray<{ callId: string; slot: number; snapshotEntryId: string; rankableEntryId: string }>;
};

export type WaiverBoardGradeBuild = { status: "GRADED"; grade: WaiverGradingBoardGrade } | { status: "BLOCKED"; issues: WaiverGradingIssue[] };

function treatmentOf(row: WaiverGradingPoolRowRef): CanonicalCallTreatment {
  switch (row.treatment) {
    case "RANKED":
      return { kind: "RANKED", waiverPoolRank: row.waiverPoolRank!, fpHundredths: row.fpHundredths! };
    case "NON_PARTICIPANT_ZERO":
      return { kind: "NON_PARTICIPANT_ZERO", reason: row.participantDisposition };
    case "INVALIDATED_PRE_LOCK":
      return { kind: "INVALIDATED_PRE_LOCK" };
    case "NEUTRALIZED":
      return row.neutralizationPrecedence
        ? { kind: "NEUTRALIZED", reason: row.participantDisposition, invalidatedPreLock: true, precedence: row.neutralizationPrecedence }
        : { kind: "NEUTRALIZED", reason: row.participantDisposition };
  }
}

function outcomeOf(output: fingerprints.CallGradeOutput): WaiverCallOutcome {
  if (output.treatment === "NEUTRALIZED") return "NEUTRALIZED";
  if (output.treatment === "INVALIDATED_PRE_LOCK") return "INVALIDATED_PRE_LOCK";
  if (output.treatment === "NON_PARTICIPANT_ZERO") return "NON_PARTICIPANT_ZERO";
  if (output.exact) return "EXACT";
  return output.inResultField ? "IN_RESULT_FIELD" : "OUTSIDE_RESULT_FIELD";
}

export function gradeWaiverBoard(contest: WaiverGradingContestRef, input: WaiverGradingBoardInput): WaiverBoardGradeBuild {
  const { position, resultFieldSize: field } = contest;
  const issues: WaiverGradingIssue[] = [];
  const issue = (code: WaiverGradingIssue["code"], detail: string) => issues.push({ code, detail, position, submissionId: input.submissionId });

  if (input.revisionKind !== "SUBMISSION" || input.revisionCallCount !== input.calls.length) {
    issue("BOARD_REVISION_INVALID", `locked revision must be a SUBMISSION holding its ${input.revisionCallCount} calls`);
  }
  const sorted = [...input.calls].sort((a, b) => a.slot - b.slot);
  if (sorted.some((call, i) => call.slot !== i + 1)) issue("BOARD_SLOTS_NOT_CONTIGUOUS", "board calls must occupy contiguous slots from 1");
  if (sorted.length > field) issue("BOARD_CALLS_EXCEED_SLOTS", `${sorted.length} calls exceed the ${field}-slot board`);
  const pool = new Map(contest.rows.map((row) => [row.rankableEntryId, row]));
  const calls = sorted.flatMap((call) => {
    const row = pool.get(call.rankableEntryId);
    if (!row) {
      issue("BOARD_CALL_WITHOUT_POOL_ROW", `slot ${call.slot} player ${call.rankableEntryId} has no row in the contest result`);
      return [];
    }
    return [{ call, row, treatment: treatmentOf(row) }];
  });
  const availableSlots = contest.effectiveAvailableSlots;
  const invalidated = calls.filter((c) => c.row.category === "INVALIDATED_CALLED_PLAYER").length;
  if (calls.length - invalidated > availableSlots) {
    issue("BOARD_CALLS_EXCEED_SLOTS", `${calls.length - invalidated} eligible calls exceed the ${availableSlots} available slots`);
  }
  if (issues.length > 0) return { status: "BLOCKED", issues };

  // Shrunken pool: per-call scoring never depends on the slot count, so the
  // calls are evaluated as submitted and board totals use the available slots.
  const slotOverflow = calls.length > availableSlots;
  const evaluation = evaluateCanonicalWaiverBoard({
    calls: calls.map((c) => ({ slot: c.call.slot, treatment: c.treatment })),
    availableSlots: Math.max(availableSlots, calls.length),
    resultFieldSize: field,
    honorScoreableSlots: contest.honorScoreableSlots,
  });
  if (evaluation.status !== "EVALUATED") {
    return { status: "BLOCKED", issues: evaluation.blockers.map((b) => ({ code: "BOARD_CALL_WITHOUT_POOL_ROW" as const, detail: b.detail, position, submissionId: input.submissionId })) };
  }

  const callGrades: WaiverGradingCallGrade[] = calls.map(({ call, row }, i) => {
    const e = evaluation.calls[i];
    const output: fingerprints.CallGradeOutput = {
      slot: call.slot,
      treatment: row.treatment,
      scored: e.scored,
      waiverPoolRank: row.waiverPoolRank,
      canonicalPositionRank: row.canonicalPositionRank,
      fpHundredths: e.fpHundredths,
      inResultField: row.waiverPoolRank !== null && row.waiverPoolRank <= field,
      exact: e.exactSlotHit,
      earnedRawPoints: e.rawPoints,
      maxRawPoints: e.scored ? maxRawPointsForSlot(call.slot, field) : null,
      honorCreditEligible: e.honorCreditEligible,
      invalidatedPreLock: e.invalidatedPreLock,
      neutralizationPrecedence: e.precedence,
    };
    return {
      ...output,
      callId: call.callId,
      snapshotEntryId: call.snapshotEntryId,
      rankableEntryId: call.rankableEntryId,
      conflictResolutionId: row.conflictResolutionId,
      inputFingerprint: fingerprints.callGradeInputFingerprint({
        slot: call.slot,
        callId: call.callId,
        snapshotEntryId: call.snapshotEntryId,
        rankableEntryId: call.rankableEntryId,
        poolRowFingerprint: row.rowFingerprint,
        resultFieldSize: field,
      }),
      outputFingerprint: fingerprints.callGradeOutputFingerprint(output),
      poolRowFingerprint: row.rowFingerprint,
      outcome: outcomeOf(output),
    };
  });

  const scored = evaluation.scoredCalls;
  const neutralized = evaluation.neutralizedSlots.length;
  const eff = Math.max(availableSlots - neutralized, 0);
  const coverageCalls = Math.min(scored, eff);
  const graded = scored > 0 && eff > 0;
  const resultKind =
    evaluation.submittedCalls === 0 ? "NA_ZERO_CALL" : evaluation.allNeutralized ? "NA_ALL_NEUTRALIZED" : eff === 0 ? "NA_NO_EFFECTIVE_SLOTS" : "SCORED";
  const output: fingerprints.BoardGradeOutput = {
    submittedCallCount: evaluation.submittedCalls,
    scoreableCallCount: scored,
    neutralizedCallCount: neutralized,
    invalidatedCallCount: evaluation.calls.filter((c) => c.invalidatedPreLock).length,
    exactCallCount: evaluation.calls.filter((c) => c.exactSlotHit).length,
    availableSlots,
    effectiveAvailableSlots: eff,
    coverageCallCount: coverageCalls,
    slotOverflow,
    earnedRawPoints: evaluation.earnedRawPoints,
    maxRawPoints: evaluation.maxRawPoints,
    coverageModifierNumerator: graded ? WAIVER_EYEQ_V1.coverageFloorPercent * eff + WAIVER_EYEQ_V1.coverageWeightPercent * coverageCalls : null,
    coverageModifierDenominator: graded ? 100 * eff : null,
    eyeqHundredths: graded
      ? waiverEyeqHundredths({ earnedRawPoints: evaluation.earnedRawPoints, maxRawPoints: evaluation.maxRawPoints, callsMade: coverageCalls, availableSlots: eff })
      : null,
    totalFpHundredths: evaluation.totalFpHundredths,
    fpPerCallHundredths: graded ? divideRoundHalfAwayFromZero(evaluation.totalFpHundredths, scored) : null,
    fpPerAvailableSlotHundredths:
      resultKind === "NA_ALL_NEUTRALIZED" || resultKind === "NA_NO_EFFECTIVE_SLOTS" || eff === 0
        ? null
        : divideRoundHalfAwayFromZero(evaluation.totalFpHundredths, eff),
    resultKind,
    ungradableReason: resultKind === "NA_NO_EFFECTIVE_SLOTS" ? deriveWaiverUngradableReason(availableSlots) : null,
    played: resultKind === "SCORED" || resultKind === "NA_ZERO_CALL",
    honorEligible: resultKind === "SCORED",
    honorIneligibleReason: resultKind === "SCORED" ? null : WAIVER_HONOR_INELIGIBLE_REASONS[resultKind],
    awardedHonor: resultKind === "SCORED" ? evaluation.perfectHonor : null,
  };
  const inputFingerprint = fingerprints.boardGradeInputFingerprint({
    submissionId: input.submissionId,
    revisionId: input.revisionId,
    revisionFingerprint: input.revisionFingerprint,
    position,
    contestResultFingerprint: contest.resultFingerprint,
    availableSlots,
    calls: callGrades.map((c) => ({ slot: c.slot, inputFingerprint: c.inputFingerprint })),
  });
  return {
    status: "GRADED",
    grade: {
      board: {
        contestId: contest.contestId,
        position,
        submissionId: input.submissionId,
        revisionId: input.revisionId,
        ...output,
        fpPerCallDenominator: scored,
        fpPerAvailableSlotDenominator: eff,
        inputFingerprint,
        outputFingerprint: fingerprints.boardGradeOutputFingerprint(output, callGrades),
      },
      calls: callGrades,
      competitor: input.competitor,
      honorScoreableSlots: contest.honorScoreableSlots,
    },
  };
}
