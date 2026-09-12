import { describe, expect, it } from "vitest";
import { zonedLocalToUtc } from "@/lib/timing/chicago";
import {
  AI_WEEKLY_SCORING_RULES,
  buildAiPromptBundle,
  buildAiRankingPrompt,
  expectedAiFieldSize,
  formatEligiblePlayerPool,
  formatLockedSelections,
  formatUnavailablePlayerPool,
  partitionAiPromptPlayers,
  RANKEYEQ_AI_WEEKLY_PROMPT_VERSION,
} from "@/lib/admin/ai-prompt";

describe("RankEyeQ AI weekly prompt (RANKEYEQ_AI_WEEKLY_V2)", () => {
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
        availability: "ACTIVE" as const,
      },
      {
        name: "CeeDee Lamb",
        team: "DAL",
        opponent: "vs NYG",
        gameStartsAt: zonedLocalToUtc(2026, 9, 13, 15, 25),
        availability: "QUESTIONABLE" as const,
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
        availability: "ACTIVE" as const,
      },
    ],
  };

  it("uses stable prompt version identifier", () => {
    expect(RANKEYEQ_AI_WEEKLY_PROMPT_VERSION).toBe("RANKEYEQ_AI_WEEKLY_V2");
    const prompt = buildAiRankingPrompt(wrContest, {
      aiDisplayName: "GPT",
      generatedAt,
    });
    expect(prompt).toContain("Prompt version: RANKEYEQ_AI_WEEKLY_V2");
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
  });

  it("fresh rerank does not anchor on a previous board", () => {
    const prompt = buildAiRankingPrompt(wrContest, {
      generatedAt,
      mode: "fresh",
    });
    expect(prompt).toContain("Rank independently from scratch");
    expect(prompt).toContain("Do not reuse or anchor on any previous ranking");
    expect(prompt).not.toContain("LOCKED SELECTIONS");
    expect(prompt).not.toContain("Your previous ranking");
  });

  it("renders eligible pool with Questionable markers", () => {
    const pool = formatEligiblePlayerPool(wrContest.players, "WR");
    expect(pool).toContain("ELIGIBLE PLAYER POOL");
    expect(pool).toContain("Justin Jefferson — MIN — WR");
    expect(pool).toContain("CeeDee Lamb — DAL — WR");
    expect(pool).toContain("Questionable");
  });

  it("Brock Bowers OUT appears in UNAVAILABLE — DO NOT SELECT", () => {
    const teContest = {
      ...wrContest,
      title: "TE Top 10",
      position: "TE" as const,
      rankingDepth: 10,
      players: [
        {
          name: "Trey McBride",
          team: "ARI",
          opponent: "@ SEA",
          gameStartsAt: zonedLocalToUtc(2026, 9, 13, 12, 0),
          availability: "ACTIVE" as const,
        },
        {
          name: "Brock Bowers",
          team: "LV",
          opponent: "vs DEN",
          gameStartsAt: zonedLocalToUtc(2026, 9, 13, 15, 25),
          availability: "OUT" as const,
        },
      ],
    };
    const { eligible, unavailable } = partitionAiPromptPlayers(
      teContest.players,
      generatedAt,
    );
    expect(eligible.map((p) => p.name)).toEqual(["Trey McBride"]);
    expect(unavailable.map((p) => p.name)).toEqual(["Brock Bowers"]);

    const prompt = buildAiRankingPrompt(teContest, { generatedAt, now: generatedAt });
    expect(prompt).toContain("UNAVAILABLE — DO NOT SELECT");
    expect(prompt).toContain("Brock Bowers");
    expect(prompt).toContain("Out");
    const eligibleBlock = prompt.split("UNAVAILABLE — DO NOT SELECT")[0] ?? "";
    expect(eligibleBlock).not.toContain("Brock Bowers");
  });

  it("rerank with locked slots keeps locked players and re-ranks rest", () => {
    const contest = {
      ...wrContest,
      lockedSelections: [
        {
          rank: 4,
          name: "Jaxon Smith-Njigba",
          team: "SEA",
          rankableEntryId: "jsn",
        },
      ],
      players: [
        ...wrContest.players,
        {
          name: "Jaxon Smith-Njigba",
          team: "SEA",
          opponent: "vs NE",
          gameStartsAt: zonedLocalToUtc(2026, 9, 9, 19, 15),
          availability: "ACTIVE" as const,
          rankableEntryId: "jsn",
        },
      ],
    };
    const prompt = buildAiRankingPrompt(contest, {
      generatedAt,
      now: generatedAt,
      mode: "rerank-with-locks",
    });
    expect(prompt).toContain("LOCKED SELECTIONS — MUST REMAIN IN THESE EXACT SLOTS");
    expect(prompt).toContain("#4 Jaxon Smith-Njigba");
    expect(prompt).toContain("Keep every locked player in the exact listed slot");
    expect(formatLockedSelections(contest.lockedSelections!)).toContain("#4");
  });

  it("formats started players as unavailable", () => {
    const started = formatUnavailablePlayerPool(
      [
        {
          name: "Early Player",
          team: "SEA",
          opponent: "vs NE",
          gameStartsAt: zonedLocalToUtc(2026, 9, 9, 19, 15),
          availability: "ACTIVE",
        },
      ],
      "WR",
      generatedAt,
    );
    expect(started).toContain("Game started");
  });

  it("bundles prompt + meta for admin UI", () => {
    const bundle = buildAiPromptBundle(wrContest, {
      aiDisplayName: "Claude",
      generatedAt,
    });
    expect(bundle.version).toBe("RANKEYEQ_AI_WEEKLY_V2");
    expect(bundle.meta.fieldSize).toBe(15);
    expect(bundle.meta.mode).toBe("fresh");
    expect(bundle.meta.position).toBe("WR");
    expect(bundle.meta.aiDisplayName).toBe("Claude");
  });
});
