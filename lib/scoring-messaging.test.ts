import { describe, expect, it } from "vitest";
import { getFantasyScoringReferenceTables } from "@/lib/fantasy/scoring-reference";
import { PLAYER_FANTASY_RULES_V1, DEFENSE_FANTASY_RULES_V1 } from "@/lib/fantasy/scoring-config";
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
  it("fantasy reference tables match PLAYER/DEFENSE rules (no yardage bonuses)", () => {
    const { offenseRows, defenseRows } = getFantasyScoringReferenceTables();
    expect(offenseRows.find((r) => r.category === "Passing yards")?.value).toBe(
      `${PLAYER_FANTASY_RULES_V1.passingYardsPerPoint} yards = 1 pt`,
    );
    expect(offenseRows.find((r) => r.category === "Passing TD")?.value).toBe(
      `${PLAYER_FANTASY_RULES_V1.passingTd} pts`,
    );
    expect(offenseRows.some((r) => /100.?yard|300.?yard|bonus/i.test(r.category))).toBe(
      false,
    );
    expect(defenseRows.find((r) => r.category === "Sack")?.value).toBe(
      `${DEFENSE_FANTASY_RULES_V1.sack} pt`,
    );
    // 100 rush yards = 10 pts only (no bonus)
    expect(scorePlayerFantasy({ rushingYards: 100 }).fantasyPoints).toBe(10);
    expect(scorePlayerFantasy({ passingYards: 300 }).fantasyPoints).toBe(12);
  });

  it("EYEQ table rows match scoring.ts constants", () => {
    expect(SCORING_TABLE_ROWS).toEqual([
      { label: "Top-N Hit", value: `+${BASE_HIT_POINTS}` },
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
