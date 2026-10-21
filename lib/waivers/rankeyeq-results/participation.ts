import {
  RANKEYEQ_DECISION_REASON_MAX,
  RANKEYEQ_EVIDENCE_REFERENCE_MAX,
  RANKEYEQ_ZERO_POINT_DECISIONS,
} from "@/lib/waivers/rankeyeq-results/contract";
import { summarizeRankEyeQParticipants } from "@/lib/waivers/rankeyeq-results/summary";
import type {
  RankEyeQDecisionRejection,
  RankEyeQDecisionRejectionCode,
  RankEyeQFinalWeekStatsContent,
  RankEyeQParticipant,
  RankEyeQParticipationDecisionInput,
  RankEyeQParticipationReviewItem,
  RankEyeQRecordedDecision,
} from "@/lib/waivers/rankeyeq-results/types";

/**
 * Operator participation review. A zero fantasy-point WeekStat row is
 * ambiguous: the player may have played and scored nothing, or never played.
 * Only an explicit operator decision (with evidence) resolves it:
 *
 *   PLAYED_ZERO   PENDING_ZERO_REVIEW → PARTICIPATED_ZERO         (disposition PLAYED, 0 hundredths)
 *   DID_NOT_PLAY  PENDING_ZERO_REVIEW → VERIFIED_NON_PARTICIPANT  (disposition DNP, no points)
 *   PENDING       leaves the participant unresolved
 *
 * A participant with no usable WeekStat row (ABSENT_UNRESOLVED) can never be
 * turned into a zero or a DNP here: missing stats stay a blocker until the
 * underlying WeekStat is corrected and the snapshot is rebuilt. Pure.
 */

export type RankEyeQAppliedDecision = { rankableEntryId: string; decision: RankEyeQRecordedDecision["decision"] };

export type RankEyeQApplyDecisionsResult = {
  content: RankEyeQFinalWeekStatsContent;
  applied: readonly RankEyeQAppliedDecision[];
  rejected: readonly RankEyeQDecisionRejection[];
};

const reject = (rankableEntryId: string, code: RankEyeQDecisionRejectionCode, detail: string): RankEyeQDecisionRejection => ({ rankableEntryId, code, detail });

function normalizeDecidedAt(value: Date | string): string | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Lists every participant the operator must still resolve before ACCEPTED publication. */
export function listRankEyeQParticipationReviewItems(content: RankEyeQFinalWeekStatsContent): RankEyeQParticipationReviewItem[] {
  const items: RankEyeQParticipationReviewItem[] = [];
  for (const participant of content.participants) {
    if (participant.participationState !== "PENDING_ZERO_REVIEW" && participant.participationState !== "ABSENT_UNRESOLVED") continue;
    items.push({
      rankableEntryId: participant.rankableEntryId,
      provider: participant.provider,
      externalId: participant.externalId,
      position: participant.position,
      team: participant.team,
      displayName: participant.displayName,
      reviewKind: participant.participationState === "PENDING_ZERO_REVIEW" ? "ZERO_POINT_REVIEW" : "UNRESOLVED_BLOCKER",
      state: participant.participationState,
      statRowId: participant.evidence.statRowId,
      gameIds: participant.gameIds,
      issues: participant.evidence.issues,
    });
  }
  return items;
}

function resolve(participant: RankEyeQParticipant, decision: RankEyeQRecordedDecision): RankEyeQParticipant {
  const evidence = { ...participant.evidence, decision };
  return decision.decision === "PLAYED_ZERO"
    ? { ...participant, participationState: "PARTICIPATED_ZERO", disposition: "PLAYED", proof: "OPERATOR_PLAYED_ZERO_REVIEW", pointsHundredths: 0, evidence }
    : { ...participant, participationState: "VERIFIED_NON_PARTICIPANT", disposition: "DNP", proof: "OPERATOR_DID_NOT_PLAY_REVIEW", pointsHundredths: null, evidence };
}

/**
 * Applies operator decisions to a built snapshot content, returning a new
 * content (the input is never mutated) plus the applied and rejected
 * decisions. Rejected decisions change nothing.
 */
export function applyParticipationDecisions(
  content: RankEyeQFinalWeekStatsContent,
  decisions: readonly RankEyeQParticipationDecisionInput[],
): RankEyeQApplyDecisionsResult {
  const byEntry = new Map(content.participants.map((participant) => [participant.rankableEntryId, participant]));
  const seen = new Set<string>();
  const rejected: RankEyeQDecisionRejection[] = [];
  const resolved = new Map<string, RankEyeQRecordedDecision>();

  for (const input of decisions) {
    const id = input.rankableEntryId;
    if (!(RANKEYEQ_ZERO_POINT_DECISIONS as readonly string[]).includes(input.decision)) {
      rejected.push(reject(id, "DECISION_UNKNOWN", `Unknown zero-point decision ${String(input.decision)}`));
      continue;
    }
    const participant = byEntry.get(id);
    if (!participant) {
      rejected.push(reject(id, "UNKNOWN_ENTRY", "No eligible snapshot participant has this rankableEntryId"));
      continue;
    }
    if (seen.has(id)) {
      rejected.push(reject(id, "DUPLICATE_DECISION", "More than one decision was supplied for this participant"));
      continue;
    }
    seen.add(id);
    if (input.decision === "PENDING") continue;
    if (participant.participationState === "ABSENT_UNRESOLVED") {
      rejected.push(
        reject(id, "UNRESOLVED_CANNOT_BE_ZEROED", "Missing or unverifiable WeekStat is never zero; fix the WeekStat row and rebuild instead of recording a decision"),
      );
      continue;
    }
    if (participant.participationState !== "PENDING_ZERO_REVIEW") {
      rejected.push(reject(id, "NOT_PENDING_ZERO_REVIEW", `Participant is ${participant.participationState}; only PENDING_ZERO_REVIEW can be decided`));
      continue;
    }
    const evidenceReference = input.evidenceReference?.trim() ?? "";
    const reason = input.reason?.trim() ?? "";
    const decidedByUserId = input.decidedByUserId?.trim() ?? "";
    const decidedAt = normalizeDecidedAt(input.decidedAt);
    if (evidenceReference === "" || evidenceReference.length > RANKEYEQ_EVIDENCE_REFERENCE_MAX) {
      rejected.push(reject(id, "EVIDENCE_REQUIRED", `An evidence reference (1-${RANKEYEQ_EVIDENCE_REFERENCE_MAX} characters) is required`));
      continue;
    }
    if (reason === "" || reason.length > RANKEYEQ_DECISION_REASON_MAX) {
      rejected.push(reject(id, "REASON_REQUIRED", `A reason (1-${RANKEYEQ_DECISION_REASON_MAX} characters) is required`));
      continue;
    }
    if (decidedByUserId === "") {
      rejected.push(reject(id, "DECIDER_REQUIRED", "The deciding operator is required"));
      continue;
    }
    if (decidedAt === null) {
      rejected.push(reject(id, "DECIDED_AT_INVALID", "decidedAt must be a valid timestamp"));
      continue;
    }
    resolved.set(id, { decision: input.decision, evidenceReference, reason, decidedByUserId, decidedAt });
  }

  const participants = content.participants.map((participant) => {
    const decision = resolved.get(participant.rankableEntryId);
    return decision ? resolve(participant, decision) : participant;
  });
  return {
    content: { ...content, participants, summary: summarizeRankEyeQParticipants(participants) },
    applied: [...resolved].map(([rankableEntryId, decision]) => ({ rankableEntryId, decision: decision.decision })),
    rejected,
  };
}
