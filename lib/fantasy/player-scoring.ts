import {
  PLAYER_FANTASY_RULES_V1,
  type PlayerFantasyScoringRules,
} from "@/lib/fantasy/scoring-config";

export type PlayerStatLine = {
  passingYards?: number;
  passingTds?: number;
  interceptions?: number;
  rushingYards?: number;
  rushingTds?: number;
  receptions?: number;
  receivingYards?: number;
  receivingTds?: number;
  twoPointConversions?: number;
  fumblesLost?: number;
  returnTds?: number;
};

export type PlayerFantasyBreakdown = {
  fantasyPoints: number;
  components: {
    passingYards: number;
    passingTds: number;
    interceptions: number;
    rushingYards: number;
    rushingTds: number;
    receptions: number;
    receivingYards: number;
    receivingTds: number;
    twoPointConversions: number;
    fumblesLost: number;
    returnTds: number;
  };
};

function n(value: number | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

/** Full PPR fantasy points from a normalized stat line (FantasyTrack standard). */
export function scorePlayerFantasy(
  stats: PlayerStatLine,
  rules: PlayerFantasyScoringRules = PLAYER_FANTASY_RULES_V1,
): PlayerFantasyBreakdown {
  const components = {
    passingYards: n(stats.passingYards) / rules.passingYardsPerPoint,
    passingTds: n(stats.passingTds) * rules.passingTd,
    interceptions: n(stats.interceptions) * rules.interception,
    rushingYards: n(stats.rushingYards) / rules.rushingYardsPerPoint,
    rushingTds: n(stats.rushingTds) * rules.rushingTd,
    receptions: n(stats.receptions) * rules.reception,
    receivingYards: n(stats.receivingYards) / rules.receivingYardsPerPoint,
    receivingTds: n(stats.receivingTds) * rules.receivingTd,
    twoPointConversions: n(stats.twoPointConversions) * rules.twoPointConversion,
    fumblesLost: n(stats.fumblesLost) * rules.fumbleLost,
    returnTds: n(stats.returnTds) * rules.returnTd,
  };

  const fantasyPoints = Object.values(components).reduce(
    (sum, value) => sum + value,
    0,
  );

  return { fantasyPoints, components };
}
