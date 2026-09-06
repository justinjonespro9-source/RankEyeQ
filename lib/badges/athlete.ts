import { getBadgeDefinition } from "@/lib/badges/catalog";
import { ATHLETE_BADGE_THRESHOLDS } from "@/lib/badges/thresholds";
import type { EarnedBadge } from "@/lib/badges/types";
import type {
  PlayerSeasonSummary,
  PlayerWeeklyProfileRow,
} from "@/lib/player-profile";

function earn(id: string, detail: string | null): EarnedBadge | null {
  const definition = getBadgeDefinition(id);
  if (!definition) return null;
  return { id: definition.id, definition, detail, earnedAtLabel: null };
}

/**
 * 3-Week Heater: any run of N consecutive graded weeks finishing ≤ maxFinish.
 */
export function detectThreeWeekHeater(
  weeklyHistory: PlayerWeeklyProfileRow[],
  options?: { minWeeks?: number; maxFinish?: number },
): { earned: boolean; detail: string | null } {
  const minWeeks =
    options?.minWeeks ?? ATHLETE_BADGE_THRESHOLDS.heaterMinWeeks;
  const maxFinish =
    options?.maxFinish ?? ATHLETE_BADGE_THRESHOLDS.heaterMaxFinish;

  const graded = weeklyHistory
    .filter((row) => row.graded && row.actualRank != null)
    .map((row) => ({
      weekNumber: row.weekNumber,
      weekLabel: row.weekLabel,
      actualRank: row.actualRank as number,
    }))
    .sort((a, b) => a.weekNumber - b.weekNumber);

  // Collapse duplicate weekNumbers (shouldn't happen) keeping best finish.
  const byWeek = new Map<number, { weekNumber: number; weekLabel: string; actualRank: number }>();
  for (const row of graded) {
    const existing = byWeek.get(row.weekNumber);
    if (!existing || row.actualRank < existing.actualRank) {
      byWeek.set(row.weekNumber, row);
    }
  }
  const weeks = [...byWeek.values()].sort(
    (a, b) => a.weekNumber - b.weekNumber,
  );

  let streak = 0;
  let bestStreak = 0;
  let prevWeek: number | null = null;
  let streakEndLabel: string | null = null;

  for (const week of weeks) {
    const consecutive =
      prevWeek != null && week.weekNumber === prevWeek + 1;
    const hot = week.actualRank <= maxFinish;
    if (hot && (streak === 0 || consecutive)) {
      streak = consecutive ? streak + 1 : 1;
      if (streak >= bestStreak) {
        bestStreak = streak;
        streakEndLabel = week.weekLabel;
      }
    } else if (hot) {
      streak = 1;
      if (streak >= bestStreak) {
        bestStreak = streak;
        streakEndLabel = week.weekLabel;
      }
    } else {
      streak = 0;
    }
    prevWeek = week.weekNumber;
  }

  if (bestStreak < minWeeks) {
    return { earned: false, detail: null };
  }
  return {
    earned: true,
    detail: `${bestStreak} consecutive Top ${maxFinish} finishes${
      streakEndLabel ? ` through ${streakEndLabel}` : ""
    }`,
  };
}

export function evaluateAthleteBadges(input: {
  summary: PlayerSeasonSummary | null;
  weeklyHistory: PlayerWeeklyProfileRow[];
}): EarnedBadge[] {
  const earned: EarnedBadge[] = [];
  const summary = input.summary;

  if (summary && summary.numberOneFinishes >= 1) {
    const badge = earn(
      "POSITION_WINNER",
      `${summary.numberOneFinishes} #1 finish${
        summary.numberOneFinishes === 1 ? "" : "es"
      }`,
    );
    if (badge) earned.push(badge);
  }

  if (summary && summary.top3Finishes >= 1) {
    const badge = earn(
      "PODIUM_FINISH",
      `${summary.top3Finishes} Top 3 finish${
        summary.top3Finishes === 1 ? "" : "es"
      }`,
    );
    if (badge) earned.push(badge);
  }

  if (summary && summary.top10Finishes >= 1) {
    const badge = earn(
      "TOP_10_FINISH",
      `${summary.top10Finishes} Top 10 finish${
        summary.top10Finishes === 1 ? "" : "es"
      }`,
    );
    if (badge) earned.push(badge);
  }

  const heater = detectThreeWeekHeater(input.weeklyHistory);
  if (heater.earned) {
    const badge = earn("THREE_WEEK_HEATER", heater.detail);
    if (badge) earned.push(badge);
  }

  return earned;
}
