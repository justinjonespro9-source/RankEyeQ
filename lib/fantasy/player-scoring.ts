import {
  PLAYER_FANTASY_RULES_HALF_PPR_V2,
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
    passingYardsBonus: number;
    rushingYardsBonus: number;
    receivingYardsBonus: number;
  };
};

function n(value: number | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function oneTimeYardageBonus(
  yards: number,
  bonus: number,
  threshold: number,
) {
  if (bonus <= 0 || threshold <= 0) return 0;
  return yards >= threshold ? bonus : 0;
}

/** Fantasy points from a normalized stat line (versioned FantasyTrack rules). */
export function scorePlayerFantasy(
  stats: PlayerStatLine,
  rules: PlayerFantasyScoringRules = PLAYER_FANTASY_RULES_HALF_PPR_V2,
): PlayerFantasyBreakdown {
  const passingYards = n(stats.passingYards);
  const rushingYards = n(stats.rushingYards);
  const receivingYards = n(stats.receivingYards);

  const components = {
    passingYards: passingYards / rules.passingYardsPerPoint,
    passingTds: n(stats.passingTds) * rules.passingTd,
    interceptions: n(stats.interceptions) * rules.interception,
    rushingYards: rushingYards / rules.rushingYardsPerPoint,
    rushingTds: n(stats.rushingTds) * rules.rushingTd,
    receptions: n(stats.receptions) * rules.reception,
    receivingYards: receivingYards / rules.receivingYardsPerPoint,
    receivingTds: n(stats.receivingTds) * rules.receivingTd,
    twoPointConversions: n(stats.twoPointConversions) * rules.twoPointConversion,
    fumblesLost: n(stats.fumblesLost) * rules.fumbleLost,
    returnTds: n(stats.returnTds) * rules.returnTd,
    passingYardsBonus: oneTimeYardageBonus(
      passingYards,
      rules.passingYardsBonus,
      rules.passingYardsBonusAt,
    ),
    rushingYardsBonus: oneTimeYardageBonus(
      rushingYards,
      rules.rushingYardsBonus,
      rules.rushingYardsBonusAt,
    ),
    receivingYardsBonus: oneTimeYardageBonus(
      receivingYards,
      rules.receivingYardsBonus,
      rules.receivingYardsBonusAt,
    ),
  };

  const fantasyPoints = Object.values(components).reduce(
    (sum, value) => sum + value,
    0,
  );

  return { fantasyPoints, components };
}
