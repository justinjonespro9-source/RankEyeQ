import { describe, expect, it } from "vitest";
import { zonedLocalToUtc } from "@/lib/timing/chicago";
import {
  AI_WEEKLY_SCORING_RULES,
  buildAiPromptBundle,
  buildAiRankingPrompt,
  expectedAiFieldSize,
  expectedAiScoringDepth,
  formatEligiblePlayerPool,
  formatLockedSelections,
  formatUnavailablePlayerPool,
  partitionAiPromptPlayers,
  RANKEYEQ_AI_WEEKLY_PROMPT_VERSION,
  type AiPromptContest,
} from "@/lib/admin/ai-prompt";

describe("RankEyeQ AI weekly prompt (RANKEYEQ_AI_WEEKLY_V3)", () => {
  const generatedAt = zonedLocalToUtc(2026, 9, 10, 9, 30);

  const wrContest: AiPromptContest = {
    title: "WR Top 15",
    seasonYear: 2026,
    sport: "NFL",
    weekLabel: "Week 1",
    weekNumber: 1,
    position: "WR",
    rankingDepth: 15,
    submissionDepth: 17,
    rankingsOpenAt: zonedLocalToUtc(2026, 9, 8, 0, 0),
    fullLockAt: zonedLocalToUtc(2026, 9, 13, 10, 0),
    players: [
      {
        name: "Justin Jefferson",
        team: "MIN",
        opponent: "@ CHI",
        gameStartsAt: zonedLocalToUtc(2026, 9, 13, 12, 0),
        availability: "ACTIVE",
      },
      {
        name: "CeeDee Lamb",
        team: "DAL",
        opponent: "vs NYG",
        gameStartsAt: zonedLocalToUtc(2026, 9, 13, 15, 25),
        availability: "QUESTIONABLE",
      },
    ],
  };

  const rbContest: AiPromptContest = {
    ...wrContest,
    title: "RB Top 10",
    position: "RB",
    rankingDepth: 10,
    submissionDepth: 12,
    players: [
      {
        name: "Bijan Robinson",
        team: "ATL",
        opponent: "vs MIN",
        gameStartsAt: zonedLocalToUtc(2026, 9, 13, 12, 0),
        availability: "ACTIVE",
      },
    ],
  };

  it("uses stable prompt version identifier", () => {
    expect(RANKEYEQ_AI_WEEKLY_PROMPT_VERSION).toBe("RANKEYEQ_AI_WEEKLY_V3");
    const prompt = buildAiRankingPrompt(wrContest, {
      aiDisplayName: "GPT",
      generatedAt,
    });
    expect(prompt).toContain("Prompt version: RANKEYEQ_AI_WEEKLY_V3");
    expect(prompt).toContain("AI competitor: GPT");
  });

  it("requests submission depth 12/17 with scoring Top 10/15", () => {
    expect(expectedAiFieldSize("QB")).toBe(12);
    expect(expectedAiFieldSize("RB")).toBe(12);
    expect(expectedAiFieldSize("WR")).toBe(17);
    expect(expectedAiFieldSize("TE")).toBe(12);
    expect(expectedAiFieldSize("DEF")).toBe(12);
    expect(expectedAiScoringDepth("WR")).toBe(15);
    expect(expectedAiScoringDepth("RB")).toBe(10);

    const wr = buildAiRankingPrompt(wrContest, { generatedAt });
    expect(wr).toContain("Rank EXACTLY 17 players (numbered 1 through 17)");
    expect(wr).toContain("Slots 1–15 are your scoring board (Top 15)");
    expect(wr).toContain("Slots 16–17 are ordered reserves (R1 then R2)");
    expect(wr).toContain("do not treat them as throwaway picks");

    const rb = buildAiRankingPrompt(rbContest, { generatedAt });
    expect(rb).toContain("Rank EXACTLY 12 players (numbered 1 through 12)");
    expect(rb).toContain("Slots 1–10 are your scoring board (Top 10)");
  });

  it("includes Half-PPR scoring rules", () => {
    const prompt = buildAiRankingPrompt(rbContest, { generatedAt });
    for (const rule of AI_WEEKLY_SCORING_RULES) {
      expect(prompt).toContain(rule);
    }
  });

  it("includes eligible / unavailable / lock sections", () => {
    const prompt = buildAiRankingPrompt(wrContest, { generatedAt });
    expect(prompt).toContain("ELIGIBLE PLAYER POOL");
    expect(prompt).toContain("Justin Jefferson");
    expect(prompt).toContain("CeeDee Lamb");
    expect(prompt).toContain("Questionable");
  });

  it("partitionAiPromptPlayers splits by availability and kickoff", () => {
    const now = zonedLocalToUtc(2026, 9, 12, 12, 0);
    const { eligible, unavailable } = partitionAiPromptPlayers(
      [
        {
          name: "Active Guy",
          team: "KC",
          opponent: "vs DEN",
          gameStartsAt: zonedLocalToUtc(2026, 9, 13, 12, 0),
          availability: "ACTIVE",
        },
        {
          name: "Out Guy",
          team: "BUF",
          opponent: "vs NYJ",
          gameStartsAt: zonedLocalToUtc(2026, 9, 13, 12, 0),
          availability: "OUT",
        },
      ],
      now,
    );
    expect(eligible.map((p) => p.name)).toEqual(["Active Guy"]);
    expect(unavailable.map((p) => p.name)).toEqual(["Out Guy"]);
  });

  it("format helpers produce section headers", () => {
    expect(
      formatEligiblePlayerPool(wrContest.players, "WR"),
    ).toContain("ELIGIBLE PLAYER POOL");
    expect(
      formatUnavailablePlayerPool(
        [
          {
            name: "Gone",
            team: "SEA",
            opponent: "vs ARI",
            gameStartsAt: null,
            availability: "OUT",
          },
        ],
        "WR",
      ),
    ).toContain("UNAVAILABLE — DO NOT SELECT");
    expect(
      formatLockedSelections([
        { rank: 2, name: "Locked RB", team: "ATL" },
      ]),
    ).toContain("LOCKED SELECTIONS");
  });

  it("rerank-with-locks preserves locked reserve slots language", () => {
    const prompt = buildAiRankingPrompt(
      {
        ...rbContest,
        lockedSelections: [
          { rank: 11, name: "Reserve One", team: "CHI" },
        ],
      },
      { generatedAt, mode: "rerank-with-locks" },
    );
    expect(prompt).toContain("including locked reserves");
    expect(prompt).toContain("#11 Reserve One");
  });

  it("bundle meta exposes scoring + submission depths", () => {
    const bundle = buildAiPromptBundle(wrContest, { generatedAt });
    expect(bundle.meta.fieldSize).toBe(17);
    expect(bundle.meta.scoringDepth).toBe(15);
    expect(bundle.version).toBe("RANKEYEQ_AI_WEEKLY_V3");
  });
});
