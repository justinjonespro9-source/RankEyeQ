import { describe, expect, it } from "vitest";
import { zonedLocalToUtc } from "@/lib/timing/chicago";
import {
  AI_WEEKLY_SCORING_RULES,
  buildAiPromptBundle,
  buildAiRankingPrompt,
  expectedAiFieldSize,
  formatEligiblePlayerPool,
  RANKEYEQ_AI_WEEKLY_PROMPT_VERSION,
} from "@/lib/admin/ai-prompt";

describe("RankEyeQ AI weekly prompt (RANKEYEQ_AI_WEEKLY_V1)", () => {
  const generatedAt = zonedLocalToUtc(2026, 9, 10, 9, 30);

  const wrContest = {
    title: "WR Top 15",
    seasonYear: 2026,
    sport: "NFL",
    weekLabel: "Week 1",
    weekNumber: 1,
    position: "WR" as const,
    rankingDepth: 15,
    rankingsOpenAt: zonedLocalToUtc(2026, 9, 8, 0, 0),
    fullLockAt: zonedLocalToUtc(2026, 9, 13, 10, 0),
    players: [
      {
        name: "Justin Jefferson",
        team: "MIN",
        opponent: "@ CHI",
        gameStartsAt: zonedLocalToUtc(2026, 9, 13, 12, 0),
      },
      {
        name: "CeeDee Lamb",
        team: "DAL",
        opponent: "vs NYG",
        gameStartsAt: zonedLocalToUtc(2026, 9, 13, 15, 25),
      },
    ],
  };

  const rbContest = {
    ...wrContest,
    title: "RB Top 10",
    position: "RB" as const,
    rankingDepth: 10,
    players: [
      {
        name: "Bijan Robinson",
        team: "ATL",
        opponent: "vs MIN",
        gameStartsAt: zonedLocalToUtc(2026, 9, 13, 12, 0),
      },
      {
        name: "Excluded Should Not Appear",
        team: "XX",
        opponent: "",
        gameStartsAt: null,
      },
    ].slice(0, 1),
  };

  it("uses stable prompt version identifier", () => {
    expect(RANKEYEQ_AI_WEEKLY_PROMPT_VERSION).toBe("RANKEYEQ_AI_WEEKLY_V1");
    const prompt = buildAiRankingPrompt(wrContest, {
      aiDisplayName: "GPT",
      generatedAt,
    });
    expect(prompt).toContain("Prompt version: RANKEYEQ_AI_WEEKLY_V1");
    expect(prompt).toContain("AI competitor: GPT");
  });

  it("uses field size by position (WR 15, others 10)", () => {
    expect(expectedAiFieldSize("QB")).toBe(10);
    expect(expectedAiFieldSize("RB")).toBe(10);
    expect(expectedAiFieldSize("WR")).toBe(15);
    expect(expectedAiFieldSize("TE")).toBe(10);
    expect(expectedAiFieldSize("DEF")).toBe(10);

    const wr = buildAiRankingPrompt(wrContest, { generatedAt });
    expect(wr).toContain("Rank exactly 15 players (Top 15)");
    expect(wr).toContain("1 through 15");
    expect(wr).toContain("Field size: 15");

    const rb = buildAiRankingPrompt(rbContest, { generatedAt });
    expect(rb).toContain("Rank exactly 10 players (Top 10)");
    expect(rb).toContain("1 through 10");
  });

  it("includes canonical Half-PPR scoring + yardage bonuses", () => {
    const prompt = buildAiRankingPrompt(wrContest, { generatedAt });
    for (const line of AI_WEEKLY_SCORING_RULES) {
      expect(prompt).toContain(line);
    }
    expect(prompt).toContain("Half-PPR");
    expect(prompt).toContain("+5 bonus for 300+ passing yards");
    expect(prompt).toContain("+5 bonus for 100+ rushing yards");
    expect(prompt).toContain("+5 bonus for 100+ receiving yards");
  });

  it("instructs independent forecasting, not consensus averaging", () => {
    const prompt = buildAiRankingPrompt(wrContest, { generatedAt });
    expect(prompt).toContain("PREDICTION ACCURACY, NOT CONSENSUS AGREEMENT");
    expect(prompt).toContain(
      "do not simply average or reproduce consensus",
    );
    expect(prompt).toContain("independent football forecast");
    expect(prompt).not.toContain("average predicted");
    expect(prompt).not.toContain("ECR");
    expect(prompt).not.toContain("% #1");
    expect(prompt).not.toContain("reproduce consensus rankings as the goal");
  });

  it("renders eligible pool with Name — TEAM — POS", () => {
    const pool = formatEligiblePlayerPool(wrContest.players, "WR");
    expect(pool).toContain("PLAYER POOL");
    expect(pool).toContain("Justin Jefferson — MIN — WR");
    expect(pool).toContain("CeeDee Lamb — DAL — WR");
    expect(pool).toContain("@ CHI");
  });

  it("omits excluded players when they are not in the contest pool", () => {
    const pool = formatEligiblePlayerPool(rbContest.players, "RB");
    expect(pool).toContain("Bijan Robinson — ATL — RB");
    expect(pool).not.toContain("Excluded Should Not Appear");
  });

  it("bundles prompt + meta for admin UI", () => {
    const bundle = buildAiPromptBundle(wrContest, {
      aiDisplayName: "Claude",
      generatedAt,
    });
    expect(bundle.version).toBe("RANKEYEQ_AI_WEEKLY_V1");
    expect(bundle.meta.fieldSize).toBe(15);
    expect(bundle.meta.eligiblePoolCount).toBe(2);
    expect(bundle.meta.position).toBe("WR");
    expect(bundle.meta.aiDisplayName).toBe("Claude");
    expect(bundle.prompt).toBe(
      buildAiRankingPrompt(wrContest, {
        aiDisplayName: "Claude",
        generatedAt,
      }),
    );
  });
});
