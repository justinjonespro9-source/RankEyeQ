import { describe, expect, it } from "vitest";
import { assignCompetitionRanks } from "@/lib/fantasy/competition-rank";
import {
  FANTASYTRACK_NFL_FULL_PPR_V1,
  FANTASYTRACK_NFL_HALF_PPR_V1,
  FANTASYTRACK_NFL_HALF_PPR_V2,
  RANKIQ_NFL_PPR_V1,
  fantasyTrackFantasyScoring,
  getFantasyRules,
  rankEyeQFantasyScoring,
  scoreWeeklyPlayerFantasy,
} from "@/lib/fantasy";

const SAMPLE_RB = {
  rushingYards: 85,
  rushingTds: 1,
  receptions: 6,
  receivingYards: 45,
  fumblesLost: 1,
};

const SAMPLE_DEF = {
  sacks: 4,
  interceptions: 2,
  fumbleRecoveries: 1,
  defensiveTds: 1,
  pointsAllowed: 10,
};

describe("FantasyTrack ↔ RankEyeQ fantasy scoring parity", () => {
  it("produces identical player fantasy points from both product facades (Half PPR V2)", () => {
    const rankEyeQ = rankEyeQFantasyScoring.scorePlayer(SAMPLE_RB);
    const fantasyTrack = fantasyTrackFantasyScoring.scorePlayer(SAMPLE_RB);
    expect(rankEyeQ.fantasyPoints).toBe(fantasyTrack.fantasyPoints);
    // 8.5 + 6 + 3 + 4.5 - 2 = 20 (under milestone thresholds)
    expect(rankEyeQ.fantasyPoints).toBe(20);
  });

  it("produces identical D/ST fantasy points from both product facades", () => {
    const rankEyeQ = rankEyeQFantasyScoring.scoreDefense(SAMPLE_DEF);
    const fantasyTrack = fantasyTrackFantasyScoring.scoreDefense(SAMPLE_DEF);
    expect(rankEyeQ.fantasyPoints).toBe(fantasyTrack.fantasyPoints);
    expect(rankEyeQ.fantasyPoints).toBe(20);
  });

  it("applies identical milestone bonuses on both facades", () => {
    const stats = {
      passingYards: 320,
      rushingYards: 110,
      receivingYards: 105,
      receptions: 2,
    };
    const rankEyeQ = rankEyeQFantasyScoring.scorePlayer(stats);
    const fantasyTrack = fantasyTrackFantasyScoring.scorePlayer(stats);
    expect(rankEyeQ.fantasyPoints).toBe(fantasyTrack.fantasyPoints);
    expect(rankEyeQ.components.passingYardsBonus).toBe(5);
    expect(rankEyeQ.components.rushingYardsBonus).toBe(5);
    expect(rankEyeQ.components.receivingYardsBonus).toBe(5);
  });

  it("resolves legacy RANKIQ_NFL_PPR_V1 slug to Full PPR (historical)", () => {
    const canonical = scoreWeeklyPlayerFantasy(
      SAMPLE_RB,
      FANTASYTRACK_NFL_FULL_PPR_V1,
    );
    const legacy = scoreWeeklyPlayerFantasy(SAMPLE_RB, RANKIQ_NFL_PPR_V1);
    expect(legacy.fantasyPoints).toBe(canonical.fantasyPoints);
    expect(getFantasyRules(RANKIQ_NFL_PPR_V1).player.reception).toBe(1);
    expect(canonical.fantasyPoints).toBe(23);
  });

  it("assigns identical positional finishes (RB4 stays RB4) from shared ranking", () => {
    const pool = [
      { id: "a", fantasyPoints: 28.4 },
      { id: "b", fantasyPoints: 22.1 },
      { id: "c", fantasyPoints: 19.5 },
      { id: "d", fantasyPoints: 17.2 },
      { id: "e", fantasyPoints: 17.2 },
    ];

    const rankEyeQRanks = rankEyeQFantasyScoring.rankFinishes(pool);
    const fantasyTrackRanks = fantasyTrackFantasyScoring.rankFinishes(pool);

    expect(rankEyeQRanks.map((row) => row.rank)).toEqual(
      fantasyTrackRanks.map((row) => row.rank),
    );
    expect(rankEyeQRanks.find((row) => row.item.id === "c")?.rank).toBe(3);
    expect(rankEyeQRanks.find((row) => row.item.id === "d")?.rank).toBe(4);
    expect(rankEyeQRanks.find((row) => row.item.id === "e")?.rank).toBe(4);
  });

  it("defaults to Half PPR V2 — 0.5 / reception + yardage milestones", () => {
    const { player, version } = getFantasyRules();
    expect(version).toBe(FANTASYTRACK_NFL_HALF_PPR_V2);
    expect(player.receptionPoints).toBe(0.5);
    expect(player.reception).toBe(0.5);
    expect(player.passingYardsBonus).toBe(5);
    expect(player.rushingYardsBonus).toBe(5);
    expect(player.receivingYardsBonus).toBe(5);

    const withFiveReceptions = scoreWeeklyPlayerFantasy({ receptions: 5 });
    const withThreeReceptions = scoreWeeklyPlayerFantasy({ receptions: 3 });
    expect(withFiveReceptions.fantasyPoints - withThreeReceptions.fantasyPoints).toBe(
      1,
    );
  });

  it("preserves Full PPR and Half PPR V1 when those version slugs are requested", () => {
    const { player } = getFantasyRules(FANTASYTRACK_NFL_FULL_PPR_V1);
    expect(player.reception).toBe(1);
    const halfV1 = scoreWeeklyPlayerFantasy(
      { receptions: 4, rushingYards: 100 },
      FANTASYTRACK_NFL_HALF_PPR_V1,
    );
    const halfV2 = scoreWeeklyPlayerFantasy(
      { receptions: 4, rushingYards: 100 },
      FANTASYTRACK_NFL_HALF_PPR_V2,
    );
    const full = scoreWeeklyPlayerFantasy({ receptions: 4 }, FANTASYTRACK_NFL_FULL_PPR_V1);
    expect(halfV1.fantasyPoints).toBe(12);
    expect(halfV2.fantasyPoints).toBe(17);
    expect(full.fantasyPoints).toBe(4);
  });

  it("matches competition rank helper used for RankEyeQ actual finishes", () => {
    const entries = [
      { id: "p1", fantasyPoints: 30 },
      { id: "p2", fantasyPoints: 24 },
      { id: "p3", fantasyPoints: 24 },
    ];
    const shared = rankEyeQFantasyScoring.rankFinishes(entries);
    const direct = assignCompetitionRanks(entries, (row) => row.fantasyPoints);
    expect(shared.map((row) => row.rank)).toEqual(direct.map((row) => row.rank));
  });
});
