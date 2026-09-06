import { scorePlayerPick, type ScoreablePick } from "@/lib/scoring";
import { topFieldHitLabel } from "@/lib/scoring-messaging";
import type { PlayerScoreBreakdown } from "@/types/scoring";

/**
 * Primary visual outcome for a graded pick on a public receipt.
 * Hierarchy (first match wins — no double-labeling):
 * Exact → Podium Call → Top 10/15 Hit → Miss
 */
export type ReceiptOutcomeKey =
  | "EXACT"
  | "PODIUM_CALL"
  | "TOP_FIELD_HIT"
  | "MISS"
  | "PENDING";

export type ReceiptOutcome = {
  key: ReceiptOutcomeKey;
  label: string;
};

export function classifyReceiptOutcome(
  breakdown: PlayerScoreBreakdown,
  fieldSize: number,
): ReceiptOutcome {
  if (breakdown.exactHit) {
    return { key: "EXACT", label: "EXACT" };
  }
  if (breakdown.podiumCallHit) {
    return { key: "PODIUM_CALL", label: "PODIUM CALL" };
  }
  if (breakdown.topNHit) {
    return {
      key: "TOP_FIELD_HIT",
      label: topFieldHitLabel(fieldSize),
    };
  }
  return { key: "MISS", label: "Miss" };
}

export type ReceiptPickLine = {
  predictedRank: number;
  playerName: string;
  team: string;
  actualRank: number | null;
  actualLabel: string;
  outcome: ReceiptOutcome;
  totalPoints: number;
  breakdown: PlayerScoreBreakdown | null;
};

export function buildReceiptPickLine(input: {
  pick: ScoreablePick & { team?: string };
  fieldSize: number;
  /** When actualRank is missing, treat as not yet graded. */
  graded: boolean;
}): ReceiptPickLine {
  const team = input.pick.team ?? "";
  if (!input.graded || !Number.isFinite(input.pick.actualRank)) {
    return {
      predictedRank: input.pick.predictedRank,
      playerName: input.pick.playerName,
      team,
      actualRank: null,
      actualLabel: "—",
      outcome: { key: "PENDING", label: "Pending" },
      totalPoints: 0,
      breakdown: null,
    };
  }

  const breakdown = scorePlayerPick(input.pick, input.fieldSize);
  const outcome = classifyReceiptOutcome(breakdown, input.fieldSize);

  return {
    predictedRank: breakdown.predictedRank,
    playerName: breakdown.playerName,
    team,
    actualRank: breakdown.actualRank,
    actualLabel: `#${breakdown.actualRank}`,
    outcome,
    totalPoints: breakdown.totalPoints,
    breakdown,
  };
}

/** Format actual finish as e.g. RB2 / WR15 for receipt tables. */
export function formatActualFinishLabel(
  position: string,
  actualRank: number | null | undefined,
) {
  if (actualRank == null || !Number.isFinite(actualRank)) return "—";
  return `${position}${actualRank}`;
}

export function receiptOutcomeTone(key: ReceiptOutcomeKey) {
  switch (key) {
    case "EXACT":
      return "border-accent/40 bg-accent-soft/60 text-accent";
    case "PODIUM_CALL":
      return "border-sky-300/60 bg-sky-50 text-sky-900";
    case "TOP_FIELD_HIT":
      return "border-emerald-300/50 bg-emerald-50 text-emerald-900";
    case "PENDING":
      return "border-border bg-surface text-muted";
    case "MISS":
    default:
      return "border-rose-200/70 bg-rose-50 text-rose-900";
  }
}
