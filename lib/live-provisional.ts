import {
  getTheoreticalMaxScore,
  normalizeRankIqScore,
  scorePlayerPick,
  type ScoreablePick,
} from "@/lib/scoring";
import type { RankingScoringConfig } from "@/lib/ranking-scoring-version";
import { getDefaultRankingScoringConfig } from "@/lib/ranking-scoring-version";
import type { PlayerScoreBreakdown } from "@/types/scoring";

/**
 * Visual standing based on the player's CURRENT actual positional rank
 * (provisional live or final) — not the user's predicted slot.
 */
export type ProvisionalStandingStatus =
  | "GOLD"
  | "SILVER"
  | "BRONZE"
  | "IN_FIELD"
  | "OUTSIDE_FIELD"
  | "PENDING";

export function provisionalStandingStatus(
  actualRank: number | null | undefined,
  fieldSize: number,
): ProvisionalStandingStatus {
  if (actualRank == null || !Number.isFinite(actualRank)) return "PENDING";
  if (actualRank === 1) return "GOLD";
  if (actualRank === 2) return "SILVER";
  if (actualRank === 3) return "BRONZE";
  if (actualRank >= 1 && actualRank <= fieldSize) return "IN_FIELD";
  return "OUTSIDE_FIELD";
}

/** Row / card background for current actual standing. */
export function provisionalStandingRowClass(
  status: ProvisionalStandingStatus,
): string {
  switch (status) {
    case "GOLD":
      return "border-amber-400/55 bg-amber-50";
    case "SILVER":
      return "border-slate-300 bg-slate-100";
    case "BRONZE":
      return "border-orange-300/70 bg-orange-50";
    case "IN_FIELD":
      return "border-emerald-300/55 bg-emerald-50";
    case "OUTSIDE_FIELD":
      return "border-border bg-surface";
    case "PENDING":
    default:
      return "border-border/80 bg-surface-elevated";
  }
}

export function provisionalStandingLabel(
  status: ProvisionalStandingStatus,
  fieldSize: number,
): string {
  switch (status) {
    case "GOLD":
      return "Current #1";
    case "SILVER":
      return "Current #2";
    case "BRONZE":
      return "Current #3";
    case "IN_FIELD":
      return fieldSize === 15 ? "In Top 15" : "In Top 10";
    case "OUTSIDE_FIELD":
      return fieldSize === 15 ? "Outside Top 15" : "Outside Top 10";
    case "PENDING":
    default:
      return "Pending";
  }
}

export type ProvisionalEyeqPickInput = {
  playerId: string;
  playerName: string;
  predictedRank: number;
  /** null / undefined = unresolved (no live fantasy points yet). */
  provisionalActualRank: number | null;
};

export type ProvisionalEyeqPickResult = {
  playerId: string;
  playerName: string;
  predictedRank: number;
  provisionalActualRank: number | null;
  resolved: boolean;
  standingStatus: ProvisionalStandingStatus;
  /** Live UI never celebrates exact hits — final grading only. */
  showExactHit: boolean;
  breakdown: PlayerScoreBreakdown | null;
};

export type ProvisionalEyeqSummary = {
  liveEyeqScore: number;
  rawPoints: number;
  maxPoints: number;
  resolvedCount: number;
  totalPicks: number;
  topNHits: number;
  numberOneHit: boolean;
  /** Exact hits exist in math when ranks match, but live UI must not celebrate them. */
  exactHitsInternal: number;
  players: ProvisionalEyeqPickResult[];
};

/**
 * Safe LIVE / provisional EYEQ wrapper.
 *
 * Uses the canonical `scorePlayerPick` for every RESOLVED pick only.
 * Unresolved picks (fantasyPoints == null → no provisional rank) are NOT
 * treated as misses and contribute 0 without miss semantics.
 *
 * Does not write normalizedScore / actualRank. Does not change final scoring.
 */
export function scoreProvisionalEyeq(
  picks: ProvisionalEyeqPickInput[],
  fieldSize: number,
  config: RankingScoringConfig = getDefaultRankingScoringConfig(),
): ProvisionalEyeqSummary {
  const maxPoints = getTheoreticalMaxScore(fieldSize, config);
  const players: ProvisionalEyeqPickResult[] = picks.map((pick) => {
    if (pick.provisionalActualRank == null) {
      return {
        playerId: pick.playerId,
        playerName: pick.playerName,
        predictedRank: pick.predictedRank,
        provisionalActualRank: null,
        resolved: false,
        standingStatus: "PENDING",
        showExactHit: false,
        breakdown: null,
      };
    }

    const scored: ScoreablePick = {
      playerId: pick.playerId,
      playerName: pick.playerName,
      predictedRank: pick.predictedRank,
      actualRank: pick.provisionalActualRank,
    };
    const breakdown = scorePlayerPick(scored, fieldSize, config);

    return {
      playerId: pick.playerId,
      playerName: pick.playerName,
      predictedRank: pick.predictedRank,
      provisionalActualRank: pick.provisionalActualRank,
      resolved: true,
      standingStatus: provisionalStandingStatus(
        pick.provisionalActualRank,
        fieldSize,
      ),
      showExactHit: false,
      breakdown,
    };
  });

  const rawPoints = players.reduce(
    (sum, row) => sum + (row.breakdown?.totalPoints ?? 0),
    0,
  );
  const resolved = players.filter((row) => row.resolved);
  const topNHits = resolved.filter((row) => row.breakdown?.topNHit).length;
  const exactHitsInternal = resolved.filter(
    (row) => row.breakdown?.exactHit,
  ).length;
  const numberOneHit = resolved.some(
    (row) => row.breakdown?.actualRank === 1 && row.breakdown.topNHit,
  );

  return {
    liveEyeqScore: normalizeRankIqScore(rawPoints, maxPoints),
    rawPoints,
    maxPoints,
    resolvedCount: resolved.length,
    totalPicks: picks.length,
    topNHits,
    numberOneHit,
    exactHitsInternal,
    players,
  };
}

/** Final-only exact-hit celebration (glow / star). Never for live provisional. */
export function shouldShowFinalExactHit(input: {
  exactHit: boolean;
  contestIsFinal: boolean;
}) {
  return input.contestIsFinal && input.exactHit;
}

export function finalExactHitRowClass(active: boolean): string {
  if (!active) return "";
  return "ring-2 ring-accent/45 shadow-[0_0_0_1px_rgba(20,184,166,0.25)]";
}
