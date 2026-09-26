/**
 * Reconstruct the board that actually produced a stored GRADED EyeQ score.
 *
 * gradeContest writes score fields only onto picks that entered the effective
 * scoring sequence (including totalPoints === 0). Picks excluded from scoring
 * keep totalPoints null after the clear+write cycle.
 *
 * Ordering: original predictedRank ascending among scored picks, then
 * re-indexed to scoring ranks 1..N. That matches deriveEffectiveBoard output
 * (remaining actives in submitted order, then promoted reserves in R-order).
 *
 * This does NOT re-derive from live availability / current kickoffs — it reads
 * what grading persisted, so it stays aligned with normalizedScore even when
 * RankableEntry fields or incomplete freezes would change a fresh derive.
 */

export type StoredScoringPickInput = {
  rankableEntryId: string;
  predictedRank: number;
  /** Non-null after gradeContest wrote this pick into the scoring sequence. */
  totalPoints: number | null;
  wasUnavailableAtKickoff?: boolean | null;
  name?: string;
  team?: string;
  actualRank?: number | null;
  basePoints?: number | null;
  accuracyPoints?: number | null;
  podiumPoints?: number | null;
};

export type StoredScoringBoardRow = {
  scoringRank: number;
  rankableEntryId: string;
  originalPredictedRank: number;
  fromReserve: boolean;
  reserveSlot: number | null;
  name: string;
  team: string;
  actualRank: number | null;
  totalPoints: number;
  basePoints: number | null;
  accuracyPoints: number | null;
  podiumPoints: number | null;
};

export type OriginalBoardAuditRow = {
  predictedRank: number;
  rankableEntryId: string;
  name: string;
  team: string;
  isReserve: boolean;
  reserveSlot: number | null;
  /** True when this pick received grading points (including 0). */
  scored: boolean;
  wasUnavailableAtKickoff: boolean | null;
  /** Human-readable role relative to the stored scoring board. */
  note: string | null;
};

export function pickWasScoredInStoredGrade(
  pick: Pick<StoredScoringPickInput, "totalPoints">,
): boolean {
  return pick.totalPoints != null;
}

/**
 * Exact historical scoring board from persisted grade writes.
 * Returns null when the submission has no scored picks (not yet graded).
 */
export function reconstructStoredScoringBoard(input: {
  picks: StoredScoringPickInput[];
  scoringDepth: number;
}): StoredScoringBoardRow[] | null {
  const scored = input.picks
    .filter(pickWasScoredInStoredGrade)
    .sort((a, b) => a.predictedRank - b.predictedRank);

  if (scored.length === 0) return null;

  return scored.map((pick, index) => {
    const fromReserve = pick.predictedRank > input.scoringDepth;
    return {
      scoringRank: index + 1,
      rankableEntryId: pick.rankableEntryId,
      originalPredictedRank: pick.predictedRank,
      fromReserve,
      reserveSlot: fromReserve
        ? pick.predictedRank - input.scoringDepth
        : null,
      name: pick.name ?? pick.rankableEntryId,
      team: pick.team ?? "",
      actualRank: pick.actualRank ?? null,
      totalPoints: pick.totalPoints as number,
      basePoints: pick.basePoints ?? null,
      accuracyPoints: pick.accuracyPoints ?? null,
      podiumPoints: pick.podiumPoints ?? null,
    };
  });
}

/**
 * Immutable original submission with audit notes for Results UI.
 */
export function buildOriginalBoardAudit(input: {
  picks: StoredScoringPickInput[];
  scoringDepth: number;
}): OriginalBoardAuditRow[] {
  const scoredOrdered = input.picks
    .filter(pickWasScoredInStoredGrade)
    .sort((a, b) => a.predictedRank - b.predictedRank);
  const scoringRankById = new Map(
    scoredOrdered.map((pick, index) => [pick.rankableEntryId, index + 1]),
  );

  return [...input.picks]
    .sort((a, b) => a.predictedRank - b.predictedRank)
    .map((pick) => {
      const isReserve = pick.predictedRank > input.scoringDepth;
      const reserveSlot = isReserve
        ? pick.predictedRank - input.scoringDepth
        : null;
      const scoringRank = scoringRankById.get(pick.rankableEntryId);
      const scored = scoringRank != null;
      let note: string | null = null;
      if (!scored && pick.wasUnavailableAtKickoff === true) {
        note = isReserve
          ? "Unavailable at kickoff — not promoted"
          : "Unavailable at kickoff — removed";
      } else if (scored && isReserve) {
        note = `Promoted into scoring board at #${scoringRank}`;
      } else if (!scored && isReserve) {
        note = "Reserve — not promoted";
      } else if (!scored) {
        note = "Not included in stored scoring board";
      }

      return {
        predictedRank: pick.predictedRank,
        rankableEntryId: pick.rankableEntryId,
        name: pick.name ?? pick.rankableEntryId,
        team: pick.team ?? "",
        isReserve,
        reserveSlot,
        scored,
        wasUnavailableAtKickoff: pick.wasUnavailableAtKickoff ?? null,
        note,
      };
    });
}
