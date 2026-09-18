import type { WeekTimingPhase } from "@/lib/timing/week-windows";

/**
 * Public Rank / Consensus copy for scoring depth vs ordered reserves.
 * Always pass contest scoringDepth + reserveCount — never infer from slotCount alone.
 */

export const RESERVE_PROMOTION_COPY =
  "Reserves are your next-best choices. They can move into a scoring slot only when one of your scoring picks becomes officially unavailable before that player’s kickoff. QUESTIONABLE and DOUBTFUL do not automatically trigger promotion.";

export const RESERVE_PROMOTION_SHORT =
  "Reserves are your next-best choices. They promote only when a scoring pick is officially unavailable before that player’s kickoff — not for QUESTIONABLE or DOUBTFUL.";

export function boardDepthShortLabel(
  scoringDepth: number,
  reserveCount: number,
): string {
  if (reserveCount <= 0) return `Top ${scoringDepth}`;
  return `Top ${scoringDepth} + ${reserveCount} reserves`;
}

/** Badge / card label: "Top 10 + 2 reserves" or legacy "Top 10". */
export function boardDepthBadgeLabel(
  scoringDepth: number,
  reserveCount: number,
): string {
  return boardDepthShortLabel(scoringDepth, reserveCount);
}

/** Board title: "Your QB Top 10 + 2 reserves" / "Your QB Top 10" when no reserves. */
export function yourBoardTitle(
  shortLabel: string,
  scoringDepth: number,
  reserveCount: number,
): string {
  const depth = boardDepthShortLabel(scoringDepth, reserveCount);
  return `Your ${shortLabel.toUpperCase()} ${depth}`;
}

/**
 * Progress / fill copy. Mentions total selected names only as the submission
 * requirement, never as “Top 12/17 rankings.”
 */
export function submissionProgressFillLabel(input: {
  filledCount: number;
  scoringDepth: number;
  reserveCount: number;
  slotCount: number;
  submissionStatus: string;
  editable: boolean;
  partialKickoffLocks?: boolean;
  fullBoardLocked?: boolean;
}): string {
  const normalized = input.submissionStatus.toUpperCase();
  const depth = boardDepthShortLabel(input.scoringDepth, input.reserveCount);
  if (input.fullBoardLocked) {
    return "Rankings Locked";
  }
  if (!input.editable && normalized !== "GRADED") {
    return "Rankings Locked";
  }
  if (input.partialKickoffLocks && input.editable) {
    return "Some selections are locked because their games have started";
  }
  if (input.filledCount < input.slotCount) {
    return `${input.filledCount} of ${input.slotCount} selected · ${depth}`;
  }
  if (normalized === "SUBMITTED") {
    return `${depth} complete — submitted; unlocked slots editable until Sunday lock`;
  }
  return `${depth} complete — submit rankings`;
}

export function boardFullMessage(
  scoringDepth: number,
  reserveCount: number,
): string {
  const depth = boardDepthShortLabel(scoringDepth, reserveCount);
  return `Your ${depth} board is full. Remove a player to add someone else.`;
}

export function humanizeWeekTimingPhase(phase: WeekTimingPhase | string): string {
  switch (phase) {
    case "upcoming":
      return "Upcoming";
    case "open":
      return "Board open";
    case "partial-lock":
      return "Partial kickoff locks";
    case "full-lock":
      return "Sunday locked";
    case "reveal":
      return "Reveal window";
    case "public":
      return "Boards public";
    case "complete":
      return "Week complete";
    default:
      return String(phase);
  }
}
