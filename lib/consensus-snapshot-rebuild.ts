/**
 * Historical Week 1 (and similar) pregame-snapshot reconstruction eligibility.
 *
 * Trust pick committedAt / lockedAt — NOT RankingSubmission.updatedAt.
 * Canonical lock processing bumps submission.updatedAt without mutating ranks.
 */

export type ReconstructionPickEvidence = {
  predictedRank: number;
  rankableEntryId: string;
  committedAt: Date | null;
  lockedAt: Date | null;
};

export type ReconstructionBoardInput = {
  status: string;
  submittedAt: Date | null;
  rankingDepth: number;
  picks: ReconstructionPickEvidence[];
  /** Already passed public consensus visibility filter. */
  publicConsensusEligible: boolean;
  statusEligible: boolean;
};

export type ReconstructionPickIssue = {
  predictedRank: number;
  rankableEntryId: string;
  issue: string;
  committedAt: string | null;
  lockedAt: string | null;
};

export type ReconstructionEligibility = {
  qualifies: boolean;
  reasons: string[];
  pickIssues: ReconstructionPickIssue[];
  scoringPickCount: number;
};

/**
 * Qualify a board for reconstructing pregame consensus at `canonicalLock`.
 *
 * Rules:
 * 1. eligible status
 * 2. public consensus visibility
 * 3. submittedAt <= canonical lock
 * 4. pickCount >= rankingDepth
 * 5. every scoring pick (1..rankingDepth) has committedAt <= canonical lock
 * 6. pick lockedAt is null, <= lock, or exactly equal to canonical lock
 *    (set by the lock operation itself)
 * 7. no evidence scoring pick identity/order changed after lock
 *    (missing committedAt on a scoring pick is treated as insufficient proof)
 *
 * Does NOT consult RankingSubmission.updatedAt.
 */
export function evaluateReconstructionEligibility(
  board: ReconstructionBoardInput,
  canonicalLock: Date,
): ReconstructionEligibility {
  const reasons: string[] = [];
  const pickIssues: ReconstructionPickIssue[] = [];
  const lockMs = canonicalLock.getTime();

  if (!board.statusEligible) {
    reasons.push(`status ${board.status} is not consensus-eligible`);
  }
  if (!board.publicConsensusEligible) {
    reasons.push("fails public consensus visibility filter");
  }
  if (board.submittedAt == null) {
    reasons.push("submittedAt missing");
  } else if (board.submittedAt.getTime() > lockMs) {
    reasons.push(
      `submittedAt ${board.submittedAt.toISOString()} after canonical lock`,
    );
  }

  const scoringPicks = board.picks
    .filter((pick) => pick.predictedRank >= 1 && pick.predictedRank <= board.rankingDepth)
    .sort((a, b) => a.predictedRank - b.predictedRank);

  if (board.picks.length < board.rankingDepth) {
    reasons.push(
      `pickCount ${board.picks.length} < rankingDepth ${board.rankingDepth}`,
    );
  }
  if (scoringPicks.length < board.rankingDepth) {
    reasons.push(
      `scoring picks ${scoringPicks.length} < rankingDepth ${board.rankingDepth}`,
    );
  }

  // Detect duplicate ranks / holes in scoring board.
  const ranks = scoringPicks.map((p) => p.predictedRank);
  if (new Set(ranks).size !== ranks.length) {
    reasons.push("duplicate predictedRank in scoring board");
  }

  for (const pick of scoringPicks) {
    if (pick.committedAt == null) {
      pickIssues.push({
        predictedRank: pick.predictedRank,
        rankableEntryId: pick.rankableEntryId,
        issue: "scoring pick missing committedAt (cannot prove pre-lock commit)",
        committedAt: null,
        lockedAt: pick.lockedAt?.toISOString() ?? null,
      });
      continue;
    }
    if (pick.committedAt.getTime() > lockMs) {
      pickIssues.push({
        predictedRank: pick.predictedRank,
        rankableEntryId: pick.rankableEntryId,
        issue: "committedAt after canonical lock",
        committedAt: pick.committedAt.toISOString(),
        lockedAt: pick.lockedAt?.toISOString() ?? null,
      });
    }
    if (pick.lockedAt != null && pick.lockedAt.getTime() > lockMs) {
      pickIssues.push({
        predictedRank: pick.predictedRank,
        rankableEntryId: pick.rankableEntryId,
        issue: "lockedAt after canonical lock",
        committedAt: pick.committedAt.toISOString(),
        lockedAt: pick.lockedAt.toISOString(),
      });
    }
  }

  if (pickIssues.length > 0) {
    reasons.push(
      `${pickIssues.length} scoring pick(s) fail pre-lock timestamp proof`,
    );
  }

  return {
    qualifies: reasons.length === 0,
    reasons,
    pickIssues,
    scoringPickCount: scoringPicks.length,
  };
}

/** Snapshot lockedAt differs from current Week.fullLockAt (stale early lock). */
export function isStalePregameSnapshot(input: {
  snapshotLockedAt: Date;
  weekFullLockAt: Date | null | undefined;
}): boolean {
  if (!input.weekFullLockAt) return false;
  return (
    input.snapshotLockedAt.getTime() !== input.weekFullLockAt.getTime()
  );
}
