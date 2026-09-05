import { describe, expect, it } from "vitest";
import { scoreDefenseFantasy } from "@/lib/fantasy/defense-scoring";
import { scorePlayerFantasy } from "@/lib/fantasy/player-scoring";
import {
  mapSportsDataDefenseGameStats,
  mapSportsDataPlayerGameStats,
} from "@/lib/providers/nfl/sportsdataio/results-map";
import {
  scoreWeeklyDefenseFantasy,
  scoreWeeklyPlayerFantasy,
} from "@/lib/fantasy/shared-engine";

/** Neutral PA tier (21–27) → 0 fantasy, so TD points are isolated. */
const NEUTRAL_PA = 24;

/**
 * Return-TD audit: player vs D/ST are separate scoring entities.
 * A real-world special-teams return TD may credit both the returner (+6)
 * and team D/ST (+6). Within each entity the TD is counted once.
 */
describe("return TD handling end-to-end", () => {
  it("awards +6 to an individual player for a punt or kick return TD", () => {
    const punt = scorePlayerFantasy({ returnTds: 1 });
    expect(punt.components.returnTds).toBe(6);
    expect(punt.fantasyPoints).toBe(6);

    const kick = scorePlayerFantasy({ returnTds: 1 });
    expect(kick.fantasyPoints).toBe(6);

    // Not double-counted as rushing/receiving TD inside the player entity
    expect(punt.components.rushingTds).toBe(0);
    expect(punt.components.receivingTds).toBe(0);
  });

  it("awards +6 to D/ST for special-teams TDs (punt/kick returns)", () => {
    const dst = scoreDefenseFantasy({
      specialTeamsTds: 1,
      pointsAllowed: NEUTRAL_PA,
    });
    expect(dst.components.touchdowns).toBe(6);
    expect(dst.components.pointsAllowed).toBe(0);
    expect(dst.fantasyPoints).toBe(6);
  });

  it("awards +6 to D/ST for interception-return and fumble-return TDs", () => {
    const intReturn = scoreDefenseFantasy({
      defensiveTds: 1,
      pointsAllowed: NEUTRAL_PA,
    });
    expect(intReturn.components.touchdowns).toBe(6);
    expect(intReturn.fantasyPoints).toBe(6);

    const fumbleReturn = scoreDefenseFantasy({
      defensiveTds: 1,
      pointsAllowed: NEUTRAL_PA,
    });
    expect(fumbleReturn.fantasyPoints).toBe(6);

    // Turnover bonuses are separate events (+2 INT / +2 FR), not a second TD count
    const intPickAndScore = scoreDefenseFantasy({
      interceptions: 1,
      defensiveTds: 1,
      pointsAllowed: NEUTRAL_PA,
    });
    expect(intPickAndScore.components.interceptions).toBe(2);
    expect(intPickAndScore.components.touchdowns).toBe(6);
    expect(intPickAndScore.fantasyPoints).toBe(8);

    const frAndScore = scoreDefenseFantasy({
      fumbleRecoveries: 1,
      defensiveTds: 1,
      pointsAllowed: NEUTRAL_PA,
    });
    expect(frAndScore.components.fumbleRecoveries).toBe(2);
    expect(frAndScore.components.touchdowns).toBe(6);
    expect(frAndScore.fantasyPoints).toBe(8);
  });

  it("allows the same special-teams TD to score for returner and team D/ST", () => {
    const player = scoreWeeklyPlayerFantasy({ returnTds: 1 });
    const defense = scoreWeeklyDefenseFantasy({
      specialTeamsTds: 1,
      pointsAllowed: NEUTRAL_PA,
    });
    expect(player.fantasyPoints).toBe(6);
    expect(defense.fantasyPoints).toBe(6);
    // Cross-entity total 12 is intentional — not a bug
    expect(player.fantasyPoints + defense.fantasyPoints).toBe(12);
  });

  it("does not double-count a TD within the player scoring entity", () => {
    const result = scorePlayerFantasy({
      returnTds: 1,
      rushingTds: 0,
      receivingTds: 0,
    });
    const tdComponents =
      result.components.returnTds +
      result.components.rushingTds +
      result.components.receivingTds +
      result.components.passingTds;
    expect(tdComponents).toBe(6);
    expect(result.fantasyPoints).toBe(6);
  });

  it("does not double-count a TD within the D/ST scoring entity", () => {
    const stOnly = scoreDefenseFantasy({
      specialTeamsTds: 1,
      defensiveTds: 0,
      pointsAllowed: NEUTRAL_PA,
    });
    expect(stOnly.components.touchdowns).toBe(6);

    const both = scoreDefenseFantasy({
      specialTeamsTds: 1,
      defensiveTds: 1,
      pointsAllowed: NEUTRAL_PA,
    });
    expect(both.components.touchdowns).toBe(12);
    expect(both.fantasyPoints).toBe(12);
  });

  it("SportsDataIO maps kick/punt returns to player returnTds and ST TDs to D/ST", () => {
    const players = mapSportsDataPlayerGameStats([
      {
        PlayerID: 1,
        KickReturnTouchdowns: 1,
        PuntReturnTouchdowns: 0,
        DefensiveTouchdowns: 0,
      },
      {
        PlayerID: 2,
        KickReturnTouchdowns: 0,
        PuntReturnTouchdowns: 1,
        DefensiveTouchdowns: 0,
      },
      {
        PlayerID: 3,
        KickReturnTouchdowns: 0,
        PuntReturnTouchdowns: 0,
        DefensiveTouchdowns: 1,
      },
    ]);
    expect(players.map((p) => p.returnTds)).toEqual([1, 1, 1]);
    expect(scoreWeeklyPlayerFantasy(players[0]).fantasyPoints).toBe(6);
    expect(scoreWeeklyPlayerFantasy(players[1]).fantasyPoints).toBe(6);

    const defenses = mapSportsDataDefenseGameStats([
      {
        Team: "KC",
        SpecialTeamsTouchdowns: 1,
        DefensiveTouchdowns: 0,
        PointsAllowed: NEUTRAL_PA,
      },
      {
        Team: "BUF",
        SpecialTeamsTouchdowns: 0,
        DefensiveTouchdowns: 1,
        PointsAllowed: NEUTRAL_PA,
      },
    ]);
    expect(defenses[0].specialTeamsTds).toBe(1);
    expect(defenses[0].defensiveTds).toBe(0);
    expect(scoreWeeklyDefenseFantasy(defenses[0]).fantasyPoints).toBe(6);
    expect(defenses[1].defensiveTds).toBe(1);
    expect(scoreWeeklyDefenseFantasy(defenses[1]).fantasyPoints).toBe(6);
  });
});
