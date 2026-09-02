import { getFantasyRules } from "@/lib/fantasy/scoring-config";

export function getFantasyScoringSummary() {
  const { player, defense, version } = getFantasyRules();
  return {
    version,
    formatLabel: player.label,
    receptionPoints: player.receptionPoints,
    summary:
      "Actual weekly player finishes use FantasyTrack Full PPR scoring — 1.0 point per reception, standard offensive and D/ST rules.",
  };
}

export function getFantasyScoringReferenceTables() {
  const { player, defense } = getFantasyRules();

  const offenseRows = [
    { category: "Passing yards", value: `${player.passingYardsPerPoint} yards = 1 pt` },
    { category: "Passing TD", value: `${player.passingTd} pts` },
    { category: "Interception", value: `${player.interception} pts` },
    { category: "Rushing yards", value: `${player.rushingYardsPerPoint} yards = 1 pt` },
    { category: "Rushing TD", value: `${player.rushingTd} pts` },
    { category: "Reception (Full PPR)", value: `${player.reception} pt each` },
    { category: "Receiving yards", value: `${player.receivingYardsPerPoint} yards = 1 pt` },
    { category: "Receiving TD", value: `${player.receivingTd} pts` },
    { category: "2-pt conversion", value: `${player.twoPointConversion} pts` },
    { category: "Fumble lost", value: `${player.fumbleLost} pts` },
    { category: "Return TD (offense)", value: `${player.returnTd} pts` },
  ];

  const defenseRows = [
    { category: "Sack", value: `${defense.sack} pt` },
    { category: "Interception", value: `${defense.interception} pts` },
    { category: "Fumble recovery", value: `${defense.fumbleRecovery} pts` },
    { category: "Defensive / ST TD", value: `${defense.defensiveOrStTd} pts` },
    { category: "Safety", value: `${defense.safety} pts` },
    { category: "Blocked kick", value: `${defense.blockedKick} pts` },
    ...defense.pointsAllowedTiers.map((tier) => ({
      category:
        tier.maxPoints === Number.POSITIVE_INFINITY
          ? "Points allowed (35+)"
          : tier.maxPoints === 0
            ? "Points allowed (shutout)"
            : `Points allowed (≤ ${tier.maxPoints})`,
      value: `${tier.fantasyPoints} pts`,
    })),
  ];

  return { offenseRows, defenseRows };
}
