import { isPromotionUnavailable } from "@/lib/reserves/promotion-status";

export type EffectiveBoardPickInput = {
  id?: string;
  rankableEntryId: string;
  predictedRank: number;
  name?: string;
  availability?: string | null;
  kickoffAt?: Date | null;
  /** Frozen at this pick's kickoff; null = not yet kicked off. */
  wasUnavailableAtKickoff?: boolean | null;
  /**
   * Snapshot of active-board entry IDs ahead of this pick when this pick locked.
   * null/undefined = reserve not yet locked → eligible for any displaced player.
   */
  reserveEligiblePredecessorIds?: string[] | null;
};

export type EffectiveBoardActivation = {
  reserveEntryId: string;
  reserveOriginalRank: number;
  reserveSlot: number;
  effectiveRank: number;
  replacedEntryId: string;
  replacedOriginalRank: number;
  replacedAvailability: string | null;
};

export type EffectiveBoardResult = {
  /** Original submitted order (immutable view). */
  original: EffectiveBoardPickInput[];
  /** Compacted active board after promotions (length ≤ scoringDepth). */
  effective: Array<{
    rankableEntryId: string;
    predictedRank: number;
    originalPredictedRank: number;
    fromReserve: boolean;
    reserveSlot: number | null;
  }>;
  activations: EffectiveBoardActivation[];
  displaced: Array<{
    rankableEntryId: string;
    originalPredictedRank: number;
    availability: string | null;
  }>;
};

function parsePredecessorIds(
  value: string[] | null | undefined,
): string[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  return value.map(String);
}

/**
 * Whether an originally active pick is removed from the scoring sequence.
 * Before kickoff: live promotion-unavailable status.
 * After kickoff: frozen wasUnavailableAtKickoff only (no retroactive status games).
 */
export function isDisplacedFromScoringBoard(input: {
  availability?: string | null;
  kickoffAt?: Date | null;
  wasUnavailableAtKickoff?: boolean | null;
  now: Date;
}): boolean {
  const kickoff = input.kickoffAt ?? null;
  if (kickoff && input.now >= kickoff) {
    return input.wasUnavailableAtKickoff === true;
  }
  return isPromotionUnavailable(input.availability);
}

/**
 * Derive the live/final effective scoring board from an immutable original board.
 *
 * Algorithm:
 * 1. Split original into active (1..scoringDepth) and ordered reserves.
 * 2. Remove displaced actives; compact remaining upward.
 * 3. Promote reserves R1 then R2 into trailing active slots when eligible.
 * 4. Anti-hindsight: a locked reserve may only fill a vacancy created by a
 *    player who was in its predecessor snapshot at reserve kickoff.
 */
export function deriveEffectiveBoard(input: {
  picks: EffectiveBoardPickInput[];
  scoringDepth: number;
  now?: Date;
}): EffectiveBoardResult {
  const now = input.now ?? new Date();
  const scoringDepth = input.scoringDepth;
  const original = [...input.picks].sort(
    (a, b) => a.predictedRank - b.predictedRank,
  );

  const active = original.filter((p) => p.predictedRank <= scoringDepth);
  const reserves = original.filter((p) => p.predictedRank > scoringDepth);

  const displaced: EffectiveBoardResult["displaced"] = [];
  const remaining: EffectiveBoardPickInput[] = [];

  for (const pick of active) {
    if (
      isDisplacedFromScoringBoard({
        availability: pick.availability,
        kickoffAt: pick.kickoffAt,
        wasUnavailableAtKickoff: pick.wasUnavailableAtKickoff,
        now,
      })
    ) {
      displaced.push({
        rankableEntryId: pick.rankableEntryId,
        originalPredictedRank: pick.predictedRank,
        availability: pick.availability ?? null,
      });
    } else {
      remaining.push(pick);
    }
  }

  // Vacancies consume displaced players in original rank order.
  const vacancies = [...displaced];
  const activations: EffectiveBoardActivation[] = [];
  const promoted: EffectiveBoardPickInput[] = [];

  for (const reserve of reserves) {
    if (remaining.length + promoted.length >= scoringDepth) break;

    // An unavailable reserve cannot enter the scoring board before its kickoff
    // (or if frozen unavailable at kickoff).
    if (
      isDisplacedFromScoringBoard({
        availability: reserve.availability,
        kickoffAt: reserve.kickoffAt,
        wasUnavailableAtKickoff: reserve.wasUnavailableAtKickoff,
        now,
      })
    ) {
      continue;
    }

    const predecessors = parsePredecessorIds(
      reserve.reserveEligiblePredecessorIds,
    );
    const reserveLocked = predecessors != null;
    const eligibleVacancyIndex = vacancies.findIndex((vacancy) => {
      if (!reserveLocked) return true;
      return predecessors.includes(vacancy.rankableEntryId);
    });
    if (eligibleVacancyIndex < 0) continue;

    const replaced = vacancies.splice(eligibleVacancyIndex, 1)[0]!;
    promoted.push(reserve);
    const effectiveRank = remaining.length + promoted.length;
    activations.push({
      reserveEntryId: reserve.rankableEntryId,
      reserveOriginalRank: reserve.predictedRank,
      reserveSlot: reserve.predictedRank - scoringDepth,
      effectiveRank,
      replacedEntryId: replaced.rankableEntryId,
      replacedOriginalRank: replaced.originalPredictedRank,
      replacedAvailability: replaced.availability,
    });
  }

  const effective = [...remaining, ...promoted]
    .slice(0, scoringDepth)
    .map((pick, index) => {
      const fromReserve = pick.predictedRank > scoringDepth;
      return {
        rankableEntryId: pick.rankableEntryId,
        predictedRank: index + 1,
        originalPredictedRank: pick.predictedRank,
        fromReserve,
        reserveSlot: fromReserve ? pick.predictedRank - scoringDepth : null,
      };
    });

  return { original, effective, activations, displaced };
}

/** Map DB-ish picks into scoreable predicted ranks for EYEQ. */
export function effectivePicksForScoring(input: {
  picks: EffectiveBoardPickInput[];
  scoringDepth: number;
  now?: Date;
}): Array<{
  playerId: string;
  predictedRank: number;
  originalPredictedRank: number;
  fromReserve: boolean;
}> {
  const board = deriveEffectiveBoard(input);
  return board.effective.map((row) => ({
    playerId: row.rankableEntryId,
    predictedRank: row.predictedRank,
    originalPredictedRank: row.originalPredictedRank,
    fromReserve: row.fromReserve,
  }));
}

/**
 * Active-board predecessor IDs for a reserve at lock time:
 * every pick currently ranked ahead of the reserve that sits in the scoring board.
 */
export function snapshotReservePredecessors(input: {
  picks: Array<{ rankableEntryId: string; predictedRank: number }>;
  reservePredictedRank: number;
  scoringDepth: number;
}): string[] {
  return input.picks
    .filter(
      (pick) =>
        pick.predictedRank < input.reservePredictedRank &&
        pick.predictedRank <= input.scoringDepth,
    )
    .sort((a, b) => a.predictedRank - b.predictedRank)
    .map((pick) => pick.rankableEntryId);
}
