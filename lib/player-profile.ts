import type { ContestPosition } from "@/lib/generated/prisma/client";

export type PlayerMarketSegmentRates = {
  all: number | null;
  human: number | null;
  expert: number | null;
  creator: number | null;
  ai: number | null;
};

export type PlayerMarketSegmentRanks = {
  all: number | null;
  human: number | null;
  expert: number | null;
  creator: number | null;
  ai: number | null;
};

export type PlayerWeeklyProfileRow = {
  weekId: string;
  weekLabel: string;
  weekNumber: number;
  contestId: string;
  position: ContestPosition;
  team: string;
  opponent: string | null;
  fantasyPoints: number | null;
  actualRank: number | null;
  graded: boolean;
  /** Immutable pregame snapshot — null when no snapshot or privacy-gated. */
  market: {
    selectionRates: PlayerMarketSegmentRates;
    averageSelectedRanks: PlayerMarketSegmentRanks;
    consensusRanks: PlayerMarketSegmentRanks;
    lockedAt: Date;
  } | null;
  marketPrivate: boolean;
};

export type PlayerRecentForm = {
  weekCount: number;
  label: string;
  fantasyPpg: number | null;
  averageFinish: number | null;
  /** Negative = improving finishes (lower rank is better). Null if not enough weeks. */
  finishTrend: number | null;
};

export type PlayerSeasonSummary = {
  weeksRecorded: number;
  weeksEligible: number;
  fantasyPpg: number | null;
  averageFinish: number | null;
  medianFinish: number | null;
  bestFinish: number | null;
  worstFinish: number | null;
  numberOneFinishes: number;
  top3Finishes: number;
  top5Finishes: number;
  top10Finishes: number;
};

export function buildPlayerRecentForm(
  weeks: Array<{
    weekNumber: number;
    fantasyPoints: number | null;
    actualRank: number | null;
    graded: boolean;
  }>,
  windowSize = 4,
): PlayerRecentForm | null {
  const graded = weeks
    .filter((row) => row.graded && row.actualRank != null)
    .sort((a, b) => b.weekNumber - a.weekNumber);

  const window = graded.slice(0, windowSize);
  if (window.length === 0) return null;

  const finishes = window.map((row) => row.actualRank as number);
  const points = window
    .map((row) => row.fantasyPoints)
    .filter((value): value is number => value != null);

  let finishTrend: number | null = null;
  if (window.length >= 2) {
    const newest = finishes[0];
    const oldest = finishes[finishes.length - 1];
    // Lower finish rank is better → negative delta means improvement.
    finishTrend = newest - oldest;
  }

  return {
    weekCount: window.length,
    label:
      window.length >= 4
        ? "Last 4 Weeks"
        : window.length === 1
          ? "Recent form"
          : `Last ${window.length} Weeks`,
    fantasyPpg:
      points.length === 0
        ? null
        : points.reduce((sum, value) => sum + value, 0) / points.length,
    averageFinish:
      finishes.reduce((sum, value) => sum + value, 0) / finishes.length,
    finishTrend,
  };
}

export function finishTierLabel(actualRank: number | null) {
  if (actualRank == null) return null;
  if (actualRank === 1) return "#1";
  if (actualRank <= 3) return "Top 3";
  if (actualRank <= 5) return "Top 5";
  if (actualRank <= 10) return "Top 10";
  return null;
}

/**
 * Deterministic “who was highest” from selection rates.
 * Creator may be null when snapshot schema has no Creator columns.
 */
export function highestSelectedGroup(rates: PlayerMarketSegmentRates): {
  key: "public" | "expert" | "creator" | "ai";
  label: string;
  rate: number;
} | null {
  const candidates: Array<{
    key: "public" | "expert" | "creator" | "ai";
    label: string;
    rate: number;
  }> = [];

  if (rates.human != null) {
    candidates.push({ key: "public", label: "Public", rate: rates.human });
  }
  if (rates.expert != null) {
    candidates.push({ key: "expert", label: "Experts", rate: rates.expert });
  }
  if (rates.creator != null) {
    candidates.push({ key: "creator", label: "Creators", rate: rates.creator });
  }
  if (rates.ai != null) {
    candidates.push({ key: "ai", label: "AI", rate: rates.ai });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.rate - a.rate || a.label.localeCompare(b.label));
  const top = candidates[0];
  if (top.rate <= 0) return null;
  return top;
}

export function formatSelectionPct(rate: number | null | undefined) {
  if (rate == null) return "—";
  return `${Math.round(rate * 100)}%`;
}

export function formatFinishTrend(trend: number | null) {
  if (trend == null) return null;
  if (trend === 0) return "Flat";
  if (trend < 0) return `Improving (${Math.abs(trend).toFixed(1)} ranks)`;
  return `Cooling (+${trend.toFixed(1)} ranks)`;
}

export function opponentFromGame(input: {
  weekTeam: string | null;
  team: string;
  game:
    | { homeTeam: string; awayTeam: string }
    | null
    | undefined;
  fallbackOpponent?: string | null;
}) {
  const team = (input.weekTeam ?? input.team).trim().toUpperCase();
  if (input.game) {
    const home = input.game.homeTeam.trim().toUpperCase();
    const away = input.game.awayTeam.trim().toUpperCase();
    if (team === home) return `@ ${input.game.awayTeam}`;
    if (team === away) return `vs ${input.game.homeTeam}`;
  }
  const fallback = input.fallbackOpponent?.trim();
  if (!fallback || fallback === "TBD") return null;
  return fallback;
}
