import {
  DEFAULT_FANTASY_SCORING_VERSION,
  getFantasyRules,
} from "@/lib/fantasy/scoring-config";

export function getFantasyScoringSummary(version?: string) {
  const { player, version: resolved } = getFantasyRules(
    version ?? DEFAULT_FANTASY_SCORING_VERSION,
  );
  const hasMilestones =
    player.passingYardsBonus > 0 ||
    player.rushingYardsBonus > 0 ||
    player.receivingYardsBonus > 0;

  let summary: string;
  if (player.reception === 0.5 && hasMilestones) {
    summary =
      "Actual weekly player finishes use FantasyTrack Half PPR scoring — 0.5 point per reception, plus one-time 300-yard passing and 100-yard rushing/receiving bonuses that can stack across categories.";
  } else if (player.reception === 0.5) {
    summary =
      "Actual weekly player finishes use FantasyTrack Half PPR scoring — 0.5 point per reception, standard offensive and D/ST rules (no yardage milestone bonuses).";
  } else {
    summary =
      "Actual weekly player finishes use FantasyTrack Full PPR scoring — 1.0 point per reception, standard offensive and D/ST rules (no yardage milestone bonuses).";
  }

  return {
    version: resolved,
    formatLabel: player.label,
    receptionPoints: player.receptionPoints,
    summary,
  };
}

export function getFantasyScoringReferenceTables(version?: string) {
  const { player, defense } = getFantasyRules(
    version ?? DEFAULT_FANTASY_SCORING_VERSION,
  );

  const receptionLabel =
    player.reception === 0.5
      ? "Reception (Half PPR)"
      : "Reception (Full PPR)";

  const offenseRows = [
    { category: "Passing yards", value: `${player.passingYardsPerPoint} yards = 1 pt` },
    { category: "Passing TD", value: `${player.passingTd} pts` },
    { category: "Interception", value: `${player.interception} pts` },
    { category: "Rushing yards", value: `${player.rushingYardsPerPoint} yards = 1 pt` },
    { category: "Rushing TD", value: `${player.rushingTd} pts` },
    { category: receptionLabel, value: `${player.reception} pt each` },
    { category: "Receiving yards", value: `${player.receivingYardsPerPoint} yards = 1 pt` },
    { category: "Receiving TD", value: `${player.receivingTd} pts` },
    { category: "2-pt conversion", value: `${player.twoPointConversion} pts` },
    { category: "Fumble lost", value: `${player.fumbleLost} pts` },
    {
      category: "Punt/kick return TD (player)",
      value: `${player.returnTd} pts`,
    },
  ];

  if (player.passingYardsBonus > 0) {
    offenseRows.push({
      category: `${player.passingYardsBonusAt}+ passing yards (bonus)`,
      value: `+${player.passingYardsBonus} (once)`,
    });
  }
  if (player.rushingYardsBonus > 0) {
    offenseRows.push({
      category: `${player.rushingYardsBonusAt}+ rushing yards (bonus)`,
      value: `+${player.rushingYardsBonus} (once)`,
    });
  }
  if (player.receivingYardsBonus > 0) {
    offenseRows.push({
      category: `${player.receivingYardsBonusAt}+ receiving yards (bonus)`,
      value: `+${player.receivingYardsBonus} (once)`,
    });
  }

  if (
    player.passingYardsBonus <= 0 &&
    player.rushingYardsBonus <= 0 &&
    player.receivingYardsBonus <= 0
  ) {
    offenseRows.push({
      category: "Yardage milestone bonuses",
      value: "None",
    });
  }

  const defenseRows = [
    { category: "Sack", value: `${defense.sack} pt` },
    { category: "Interception", value: `${defense.interception} pts` },
    { category: "Fumble recovery", value: `${defense.fumbleRecovery} pts` },
    {
      category: "INT/fumble-return TD (D/ST)",
      value: `${defense.defensiveOrStTd} pts`,
    },
    {
      category: "Punt/kick return TD (D/ST)",
      value: `${defense.defensiveOrStTd} pts`,
    },
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
