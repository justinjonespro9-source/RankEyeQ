import type { ContestPosition } from "@/lib/generated/prisma/client";
import type {
  AthleteBadgeId,
  BadgeDefinition,
  CompetitorBadgeId,
} from "@/lib/badges/types";
import { PERCENTILE_CUTOFFS } from "@/lib/badges/thresholds";

const POSITIONS: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];

function percentileBadge(
  id: CompetitorBadgeId,
  label: string,
  shortLabel: string,
  percentile: number,
  position?: ContestPosition,
): BadgeDefinition {
  const scope = position
    ? `${position} boards`
    : "season leaderboard (qualified average EYEQ)";
  return {
    id,
    family: "competitor",
    category: "season_percentile",
    label,
    shortLabel,
    description: `Top ${Math.round(percentile * 100)}% by qualified average EYEQ on the ${scope}.`,
    phase: 1,
    position,
    percentile,
  };
}

function buildPositionPercentileBadges(): BadgeDefinition[] {
  const out: BadgeDefinition[] = [];
  for (const position of POSITIONS) {
    out.push(
      percentileBadge(
        `TOP_1_${position}` as CompetitorBadgeId,
        `Top 1% ${position}`,
        `Top 1% ${position}`,
        PERCENTILE_CUTOFFS.top1,
        position,
      ),
      percentileBadge(
        `TOP_5_${position}` as CompetitorBadgeId,
        `Top 5% ${position}`,
        `Top 5% ${position}`,
        PERCENTILE_CUTOFFS.top5,
        position,
      ),
      percentileBadge(
        `TOP_10_${position}` as CompetitorBadgeId,
        `Top 10% ${position}`,
        `Top 10% ${position}`,
        PERCENTILE_CUTOFFS.top10,
        position,
      ),
    );
  }
  return out;
}

const COMPETITOR_CATALOG: BadgeDefinition[] = [
  percentileBadge(
    "TOP_1_OVERALL",
    "Top 1% Overall",
    "Top 1%",
    PERCENTILE_CUTOFFS.top1,
  ),
  percentileBadge(
    "TOP_5_OVERALL",
    "Top 5% Overall",
    "Top 5%",
    PERCENTILE_CUTOFFS.top5,
  ),
  percentileBadge(
    "TOP_10_OVERALL",
    "Top 10% Overall",
    "Top 10%",
    PERCENTILE_CUTOFFS.top10,
  ),
  ...buildPositionPercentileBadges(),
  {
    id: "EXACT_HIT",
    family: "competitor",
    category: "hit",
    label: "Exact Hit",
    shortLabel: "Exact",
    description:
      "Predicted a player’s exact positional finish inside the ranked field.",
    phase: 1,
  },
  {
    id: "PODIUM_CALL",
    family: "competitor",
    category: "hit",
    label: "Podium Call",
    shortLabel: "Podium",
    description:
      "Ranked a player in your Top 3 who finished in the actual Top 3.",
    phase: 1,
  },
  {
    id: "HOT_STREAK",
    family: "competitor",
    category: "streak",
    label: "Hot Streak",
    shortLabel: "Streak",
    description:
      "Three consecutive NFL weeks with strong average EYEQ on graded boards.",
    phase: 1,
  },
];

const ATHLETE_CATALOG: BadgeDefinition[] = [
  {
    id: "POSITION_WINNER",
    family: "athlete",
    category: "finish",
    label: "Position Winner",
    shortLabel: "#1",
    description: "Finished #1 at the position in a graded week.",
    phase: 1,
  },
  {
    id: "PODIUM_FINISH",
    family: "athlete",
    category: "finish",
    label: "Podium Finish",
    shortLabel: "Top 3",
    description: "Finished in the Top 3 at the position in a graded week.",
    phase: 1,
  },
  {
    id: "TOP_10_FINISH",
    family: "athlete",
    category: "finish",
    label: "Top 10 Finish",
    shortLabel: "Top 10",
    description: "Finished in the Top 10 at the position in a graded week.",
    phase: 1,
  },
  {
    id: "THREE_WEEK_HEATER",
    family: "athlete",
    category: "streak",
    label: "3-Week Heater",
    shortLabel: "Heater",
    description:
      "Finished Top 10 in three consecutive graded weeks at this position.",
    phase: 1,
  },
];

const BY_ID = new Map<string, BadgeDefinition>(
  [...COMPETITOR_CATALOG, ...ATHLETE_CATALOG].map((def) => [def.id, def]),
);

export function getBadgeDefinition(id: string): BadgeDefinition | null {
  return BY_ID.get(id) ?? null;
}

export function listCompetitorBadgeDefinitions(): BadgeDefinition[] {
  return COMPETITOR_CATALOG.filter((def) => def.phase === 1);
}

export function listAthleteBadgeDefinitions(): BadgeDefinition[] {
  return ATHLETE_CATALOG.filter((def) => def.phase === 1);
}

export function listPhase1BadgeDefinitions(): BadgeDefinition[] {
  return [...listCompetitorBadgeDefinitions(), ...listAthleteBadgeDefinitions()];
}

/** Future monthly / market badges register here without touching Phase 1 evaluators. */
export function listReservedBadgeCategories(): Array<
  Extract<BadgeDefinition["category"], "monthly" | "market">
> {
  return ["monthly", "market"];
}

export type { AthleteBadgeId, CompetitorBadgeId };
