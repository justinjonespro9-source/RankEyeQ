import {
  DEFENSE_FANTASY_RULES_HALF_PPR_V2,
  type DefenseFantasyScoringRules,
} from "@/lib/fantasy/scoring-config";

export type DefenseStatLine = {
  sacks?: number;
  interceptions?: number;
  fumbleRecoveries?: number;
  defensiveTds?: number;
  specialTeamsTds?: number;
  safeties?: number;
  blockedKicks?: number;
  pointsAllowed?: number;
};

export type DefenseFantasyBreakdown = {
  fantasyPoints: number;
  pointsAllowedPoints: number;
  components: {
    sacks: number;
    interceptions: number;
    fumbleRecoveries: number;
    touchdowns: number;
    safeties: number;
    blockedKicks: number;
    pointsAllowed: number;
  };
};

function n(value: number | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

export function pointsAllowedFantasyPoints(
  pointsAllowed: number,
  rules: DefenseFantasyScoringRules = DEFENSE_FANTASY_RULES_HALF_PPR_V2,
) {
  const pts = Math.max(0, Math.floor(pointsAllowed));
  for (const tier of rules.pointsAllowedTiers) {
    if (pts <= tier.maxPoints) return tier.fantasyPoints;
  }
  return -4;
}

/** Standard D/ST fantasy points (versioned FantasyTrack rules). */
export function scoreDefenseFantasy(
  stats: DefenseStatLine,
  rules: DefenseFantasyScoringRules = DEFENSE_FANTASY_RULES_HALF_PPR_V2,
): DefenseFantasyBreakdown {
  const pointsAllowedPts = pointsAllowedFantasyPoints(
    n(stats.pointsAllowed),
    rules,
  );
  const touchdowns =
    (n(stats.defensiveTds) + n(stats.specialTeamsTds)) *
    rules.defensiveOrStTd;

  const components = {
    sacks: n(stats.sacks) * rules.sack,
    interceptions: n(stats.interceptions) * rules.interception,
    fumbleRecoveries: n(stats.fumbleRecoveries) * rules.fumbleRecovery,
    touchdowns,
    safeties: n(stats.safeties) * rules.safety,
    blockedKicks: n(stats.blockedKicks) * rules.blockedKick,
    pointsAllowed: pointsAllowedPts,
  };

  const fantasyPoints = Object.values(components).reduce(
    (sum, value) => sum + value,
    0,
  );

  return {
    fantasyPoints,
    pointsAllowedPoints: pointsAllowedPts,
    components,
  };
}
