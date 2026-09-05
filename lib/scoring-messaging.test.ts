import { describe, expect, it } from "vitest";
import { getFantasyScoringReferenceTables } from "@/lib/fantasy/scoring-reference";
import {
  PLAYER_FANTASY_RULES_HALF_PPR_V2,
  DEFENSE_FANTASY_RULES_HALF_PPR_V2,
  FANTASYTRACK_NFL_HALF_PPR_V1,
  getFantasyRules,
} from "@/lib/fantasy/scoring-config";
import { scorePlayerFantasy } from "@/lib/fantasy/player-scoring";
import {
  getEyeqWorkedExample,
  SCORING_TABLE_ROWS,
} from "@/lib/scoring-messaging";
import {
  ACTUAL_PODIUM_POINTS,
  BASE_HIT_POINTS,
  PODIUM_CALL_BONUS,
  PRECISION_EXACT,
  scorePlayerPick,
} from "@/lib/scoring";

describe("public scoring copy stays tied to engines", () => {
  it("fantasy reference tables match Half PPR V2 PLAYER/DEFENSE rules with milestones", () => {
    const { offenseRows, defenseRows } = getFantasyScoringReferenceTables();
    expect(offenseRows.find((r) => r.category === "Passing yards")?.value).toBe(
      `${PLAYER_FANTASY_RULES_HALF_PPR_V2.passingYardsPerPoint} yards = 1 pt`,
    );
    expect(offenseRows.find((r) => r.category === "Passing TD")?.value).toBe(
      `${PLAYER_FANTASY_RULES_HALF_PPR_V2.passingTd} pts`,
    );
    expect(
      offenseRows.find((r) => r.category === "Reception (Half PPR)")?.value,
    ).toBe("0.5 pt each");
    expect(
      offenseRows.find((r) => r.category === "Punt/kick return TD (player)")
        ?.value,
    ).toBe(`${PLAYER_FANTASY_RULES_HALF_PPR_V2.returnTd} pts`);
    expect(
      offenseRows.find((r) => r.category === "300+ passing yards (bonus)")?.value,
    ).toBe("+5 (once)");
    expect(
      offenseRows.find((r) => r.category === "100+ rushing yards (bonus)")?.value,
    ).toBe("+5 (once)");
    expect(
      offenseRows.find((r) => r.category === "100+ receiving yards (bonus)")
        ?.value,
    ).toBe("+5 (once)");
    expect(
      defenseRows.find((r) => r.category === "Punt/kick return TD (D/ST)")?.value,
    ).toBe(`${DEFENSE_FANTASY_RULES_HALF_PPR_V2.defensiveOrStTd} pts`);
    expect(
      defenseRows.find((r) => r.category === "INT/fumble-return TD (D/ST)")
        ?.value,
    ).toBe(`${DEFENSE_FANTASY_RULES_HALF_PPR_V2.defensiveOrStTd} pts`);
    expect(defenseRows.find((r) => r.category === "Sack")?.value).toBe(
      `${DEFENSE_FANTASY_RULES_HALF_PPR_V2.sack} pt`,
    );
    expect(scorePlayerFantasy({ rushingYards: 100 }).fantasyPoints).toBe(15);
    expect(scorePlayerFantasy({ passingYards: 300 }).fantasyPoints).toBe(17);
  });

  it("Half PPR V1 reference tables still show no milestone bonuses", () => {
    const { offenseRows } = getFantasyScoringReferenceTables(
      FANTASYTRACK_NFL_HALF_PPR_V1,
    );
    expect(
      offenseRows.find((r) => r.category === "Yardage milestone bonuses")?.value,
    ).toBe("None");
    const { player } = getFantasyRules(FANTASYTRACK_NFL_HALF_PPR_V1);
    expect(scorePlayerFantasy({ rushingYards: 100 }, player).fantasyPoints).toBe(
      10,
    );
  });

  it("EYEQ table rows use Top 10 / Top 15 Hit labels", () => {
    expect(SCORING_TABLE_ROWS).toEqual([
      { label: "Top 10 Hit (QB/RB/TE/DEF)", value: `+${BASE_HIT_POINTS}` },
      { label: "Top 15 Hit (WR)", value: `+${BASE_HIT_POINTS}` },
      { label: "Precision — exact", value: "+5" },
      { label: "Precision — off by 1", value: "+3" },
      { label: "Precision — off by 2", value: "+1" },
      { label: "Actual podium — #1", value: `+${ACTUAL_PODIUM_POINTS[1]}` },
      { label: "Actual podium — #2", value: `+${ACTUAL_PODIUM_POINTS[2]}` },
      { label: "Actual podium — #3", value: `+${ACTUAL_PODIUM_POINTS[3]}` },
      { label: "Podium Call", value: `+${PODIUM_CALL_BONUS}` },
    ]);
  });

  it("worked example totals equal scorePlayerPick", () => {
    const example = getEyeqWorkedExample();
    for (const pick of example.picks) {
      const scored = scorePlayerPick(
        {
          playerId: "x",
          playerName: "x",
          predictedRank: pick.predictedRank,
          actualRank: pick.actualRank,
        },
        example.fieldSize,
      );
      expect(pick.totalPoints).toBe(scored.totalPoints);
    }
    expect(example.picks[0].totalPoints).toBe(
      BASE_HIT_POINTS + ACTUAL_PODIUM_POINTS[1] + PODIUM_CALL_BONUS,
    );
    expect(example.picks[2].totalPoints).toBe(BASE_HIT_POINTS + PRECISION_EXACT);
    expect(example.picks[3].totalPoints).toBe(0);
  });
});
