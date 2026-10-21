import {
  RANKEYEQ_PARTICIPATION_STATES,
  RANKEYEQ_POSITIONS,
  type RankEyeQParticipationState,
} from "@/lib/waivers/rankeyeq-results/contract";
import type { RankEyeQFinalWeekStatsSummary, RankEyeQParticipant } from "@/lib/waivers/rankeyeq-results/types";

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Contract order: position (QB, RB, WR, TE, DEF) then rankableEntryId by UTF-16 code unit. */
export function sortRankEyeQParticipants(participants: readonly RankEyeQParticipant[]): RankEyeQParticipant[] {
  const order = new Map<string, number>(RANKEYEQ_POSITIONS.map((position, index) => [position, index]));
  return [...participants].sort(
    (a, b) => (order.get(a.position) ?? 99) - (order.get(b.position) ?? 99) || byCodeUnit(a.rankableEntryId, b.rankableEntryId),
  );
}

export function summarizeRankEyeQParticipants(participants: readonly RankEyeQParticipant[]): RankEyeQFinalWeekStatsSummary {
  const byState = Object.fromEntries(RANKEYEQ_PARTICIPATION_STATES.map((state) => [state, 0])) as Record<RankEyeQParticipationState, number>;
  for (const participant of participants) byState[participant.participationState] += 1;
  return {
    participantCount: participants.length,
    byState,
    pendingZeroCount: byState.PENDING_ZERO_REVIEW,
    unresolvedCount: byState.ABSENT_UNRESOLVED + byState.PENDING_ZERO_REVIEW,
  };
}
