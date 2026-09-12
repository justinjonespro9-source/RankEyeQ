import type { EntryAvailability } from "@/lib/generated/prisma/client";
import {
  deriveEffectiveBoard,
  effectivePicksForScoring,
  type EffectiveBoardPickInput,
  type EffectiveBoardResult,
} from "@/lib/reserves/effective-board";
import { isPromotionUnavailable } from "@/lib/reserves/promotion-status";

export type DbishReservePick = {
  id?: string;
  rankableEntryId: string;
  predictedRank: number;
  wasUnavailableAtKickoff?: boolean | null;
  reserveEligiblePredecessorIds?: unknown;
  rankableEntry?: {
    name?: string;
    availability?: EntryAvailability | string | null;
    gameStartsAt?: Date | null;
    game?: { startsAt: Date | null } | null;
  } | null;
};

function parseJsonStringArray(value: unknown): string[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(String);
  return null;
}

export function kickoffFromRankable(entry: {
  gameStartsAt?: Date | null;
  game?: { startsAt: Date | null } | null;
} | null | undefined): Date | null {
  return entry?.game?.startsAt ?? entry?.gameStartsAt ?? null;
}

export function toEffectiveBoardPickInput(
  pick: DbishReservePick,
  kickoffOverride?: Date | null,
): EffectiveBoardPickInput {
  return {
    id: pick.id,
    rankableEntryId: pick.rankableEntryId,
    predictedRank: pick.predictedRank,
    name: pick.rankableEntry?.name,
    availability: pick.rankableEntry?.availability ?? null,
    kickoffAt:
      kickoffOverride !== undefined
        ? kickoffOverride
        : kickoffFromRankable(pick.rankableEntry),
    wasUnavailableAtKickoff: pick.wasUnavailableAtKickoff ?? null,
    reserveEligiblePredecessorIds: parseJsonStringArray(
      pick.reserveEligiblePredecessorIds,
    ),
  };
}

export function deriveEffectiveBoardFromPicks(input: {
  picks: DbishReservePick[];
  scoringDepth: number;
  kickoffByEntryId?: Map<string, Date | null>;
  now?: Date;
}): EffectiveBoardResult {
  const picks = input.picks.map((pick) =>
    toEffectiveBoardPickInput(
      pick,
      input.kickoffByEntryId?.get(pick.rankableEntryId),
    ),
  );
  return deriveEffectiveBoard({
    picks,
    scoringDepth: input.scoringDepth,
    now: input.now,
  });
}

export function scoreableEffectivePicks(input: {
  picks: DbishReservePick[];
  scoringDepth: number;
  kickoffByEntryId?: Map<string, Date | null>;
  now?: Date;
}) {
  const picks = input.picks.map((pick) =>
    toEffectiveBoardPickInput(
      pick,
      input.kickoffByEntryId?.get(pick.rankableEntryId),
    ),
  );
  return effectivePicksForScoring({
    picks,
    scoringDepth: input.scoringDepth,
    now: input.now,
  });
}

export function freezeUnavailableAtKickoff(
  availability: EntryAvailability | string | null | undefined,
): boolean {
  return isPromotionUnavailable(availability);
}
