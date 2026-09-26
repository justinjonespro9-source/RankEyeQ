import { describe, expect, it } from "vitest";
import { zonedLocalToUtc } from "@/lib/timing/chicago";
import {
  AI_WEEKLY_SCORING_RULES,
  buildAiPromptBundle,
  buildAiRankingPrompt,
  expectedAiFieldSize,
  expectedAiScoringDepth,
  formatEligiblePlayerPool,
  formatKickedOffPlayerPool,
  formatUnavailablePlayerPool,
  partitionAiPromptPlayers,
  RANKEYEQ_AI_WEEKLY_PROMPT_VERSION,
  type AiPromptContest,
} from "@/lib/admin/ai-prompt";
import {
  mergeUniversalRankingIntoLockedBoard,
  orderedMatchedIdsFromUniversalPaste,
} from "@/lib/admin/ai-parser";

describe("RankEyeQ AI weekly prompt (RANKEYEQ_AI_WEEKLY_V6)", () => {
  const generatedAt = zonedLocalToUtc(2026, 9, 10, 9, 30);

  const qbContest: AiPromptContest = {
    title: "QB Top 10",
    seasonYear: 2026,
    sport: "NFL",
    weekLabel: "Week 2",
    weekNumber: 2,
    position: "QB",
    rankingDepth: 10,
    submissionDepth: 12,
    rankingsOpenAt: zonedLocalToUtc(2026, 9, 15, 0, 0),
    fullLockAt: zonedLocalToUtc(2026, 9, 20, 10, 0),
    players: [
      {
        name: "Josh Allen",
        team: "BUF",
        opponent: "vs NYJ",
        gameStartsAt: zonedLocalToUtc(2026, 9, 20, 12, 0),
        availability: "ACTIVE",
        rankableEntryId: "allen",
      },
      {
        name: "Lamar Jackson",
        team: "BAL",
        opponent: "@ CLE",
        gameStartsAt: zonedLocalToUtc(2026, 9, 20, 12, 0),
        availability: "QUESTIONABLE",
        rankableEntryId: "lamar",
      },
      {
        name: "Out QB",
        team: "SEA",
        opponent: "vs ARI",
        gameStartsAt: zonedLocalToUtc(2026, 9, 20, 15, 25),
        availability: "OUT",
        rankableEntryId: "out-qb",
      },
    ],
  };

  const wrContest: AiPromptContest = {
    title: "WR Top 15",
    seasonYear: 2026,
    sport: "NFL",
    weekLabel: "Week 2",
    weekNumber: 2,
    position: "WR",
    rankingDepth: 15,
    submissionDepth: 17,
    rankingsOpenAt: zonedLocalToUtc(2026, 9, 15, 0, 0),
    fullLockAt: zonedLocalToUtc(2026, 9, 20, 10, 0),
    players: [
      {
        name: "Justin Jefferson",
        team: "MIN",
        opponent: "@ CHI",
        gameStartsAt: zonedLocalToUtc(2026, 9, 20, 12, 0),
        availability: "ACTIVE",
      },
    ],
  };

  it("uses RANKEYEQ_AI_WEEKLY_V6 with neutral intro and no profile identity", () => {
    expect(RANKEYEQ_AI_WEEKLY_PROMPT_VERSION).toBe("RANKEYEQ_AI_WEEKLY_V6");
    const prompt = buildAiRankingPrompt(qbContest, {
      aiDisplayName: "Claude",
      generatedAt,
    });
    expect(prompt).toContain(
      "You are competing in RankEyeQ, a weekly fantasy-football player-ranking competition.",
    );
    expect(prompt).toContain("Prompt version: RANKEYEQ_AI_WEEKLY_V6");
    expect(prompt).not.toContain("AI competitor:");
    expect(prompt).not.toContain("Claude");
    expect(prompt).not.toContain("Gemini");
    expect(prompt).not.toContain("profile");
  });

  it("Claude and Gemini profiles produce byte-identical QB prompts", () => {
    const claude = buildAiRankingPrompt(qbContest, {
      aiDisplayName: "Claude",
      generatedAt,
    });
    const gemini = buildAiRankingPrompt(qbContest, {
      aiDisplayName: "Gemini",
      generatedAt,
    });
    expect(claude).toBe(gemini);
    expect(claude).not.toContain("Claude");
    expect(claude).not.toContain("Gemini");
  });

  it("prompts for different positions remain different", () => {
    const qb = buildAiRankingPrompt(qbContest, { generatedAt });
    const wr = buildAiRankingPrompt(wrContest, { generatedAt });
    expect(qb).not.toBe(wr);
    expect(qb).toContain("Position: QB");
    expect(wr).toContain("Position: WR");
    expect(qb).toContain("Rank EXACTLY 12 players");
    expect(wr).toContain("Rank EXACTLY 17 players");
  });

  it("requests submission depth 12/17 with scoring Top 10/15", () => {
    expect(expectedAiFieldSize("QB")).toBe(12);
    expect(expectedAiFieldSize("WR")).toBe(17);
    expect(expectedAiScoringDepth("WR")).toBe(15);
    expect(expectedAiScoringDepth("RB")).toBe(10);
  });

  it("includes Half-PPR scoring rules", () => {
    const prompt = buildAiRankingPrompt(qbContest, { generatedAt });
    for (const rule of AI_WEEKLY_SCORING_RULES) {
      expect(prompt).toContain(rule);
    }
  });

  it("partitions kicked-off separately from official unavailable", () => {
    const now = zonedLocalToUtc(2026, 9, 18, 20, 0);
    const { eligible, unavailable, kickedOff } = partitionAiPromptPlayers(
      [
        {
          name: "Active Guy",
          team: "KC",
          opponent: "vs DEN",
          gameStartsAt: zonedLocalToUtc(2026, 9, 20, 12, 0),
          availability: "ACTIVE",
        },
        {
          name: "Out Guy",
          team: "BUF",
          opponent: "vs NYJ",
          gameStartsAt: zonedLocalToUtc(2026, 9, 20, 12, 0),
          availability: "OUT",
        },
        {
          name: "Thursday Starter",
          team: "DET",
          opponent: "vs GB",
          gameStartsAt: zonedLocalToUtc(2026, 9, 17, 19, 15),
          availability: "ACTIVE",
        },
      ],
      now,
    );
    expect(eligible.map((p) => p.name)).toEqual(["Active Guy"]);
    expect(unavailable.map((p) => p.name)).toEqual(["Out Guy"]);
    expect(kickedOff.map((p) => p.name)).toEqual(["Thursday Starter"]);
  });

  it("prompt uses KICKED OFF — CANNOT BE ADDED, not OUT, for kicked-off players", () => {
    const now = zonedLocalToUtc(2026, 9, 18, 20, 0);
    const players = [
      {
        name: "Sunday QB",
        team: "BUF",
        opponent: "vs NYJ",
        gameStartsAt: zonedLocalToUtc(2026, 9, 20, 12, 0),
        availability: "ACTIVE" as const,
        rankableEntryId: "sun-qb",
      },
      {
        name: "Out QB",
        team: "SEA",
        opponent: "vs ARI",
        gameStartsAt: zonedLocalToUtc(2026, 9, 20, 15, 25),
        availability: "OUT" as const,
        rankableEntryId: "out-qb",
      },
      {
        name: "Thursday QB",
        team: "DET",
        opponent: "vs GB",
        gameStartsAt: zonedLocalToUtc(2026, 9, 17, 19, 15),
        availability: "ACTIVE" as const,
        rankableEntryId: "thu-qb",
      },
    ];
    const { eligible, unavailable, kickedOff } = partitionAiPromptPlayers(
      players,
      now,
    );
    expect(eligible.map((p) => p.name)).toEqual(["Sunday QB"]);
    expect(unavailable.map((p) => p.name)).toEqual(["Out QB"]);
    expect(kickedOff.map((p) => p.name)).toEqual(["Thursday QB"]);

    const prompt = buildAiRankingPrompt(
      { ...qbContest, players },
      { generatedAt: now, now },
    );
    expect(prompt).toMatch(/KICKED OFF — CANNOT BE ADDED\n- Thursday QB/);
    expect(prompt).toMatch(/UNAVAILABLE — DO NOT SELECT\n- Out QB/);
    expect(prompt).toMatch(/ELIGIBLE PLAYER POOL\n- Sunday QB/);
  });

  it("ignores lockedSelections in universal prompt text", () => {
    const prompt = buildAiRankingPrompt(
      {
        ...qbContest,
        lockedSelections: [
          { rank: 1, name: "Josh Allen", team: "BUF", rankableEntryId: "allen" },
        ],
      },
      { generatedAt, mode: "rerank-with-locks" as never },
    );
    expect(prompt).not.toContain("LOCKED SELECTIONS");
    expect(prompt).not.toContain("#1 Josh Allen");
    expect(prompt).toContain("Mode: fresh");
  });

  it("format helpers produce section headers", () => {
    expect(formatEligiblePlayerPool(qbContest.players, "QB")).toContain(
      "ELIGIBLE PLAYER POOL",
    );
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
        "QB",
      ),
    ).toContain("UNAVAILABLE — DO NOT SELECT");
    expect(
      formatKickedOffPlayerPool(
        [
          {
            name: "Started",
            team: "DET",
            opponent: "vs GB",
            gameStartsAt: zonedLocalToUtc(2026, 9, 17, 19, 15),
            availability: "ACTIVE",
          },
        ],
        "QB",
      ),
    ).toContain("KICKED OFF — CANNOT BE ADDED");
  });

  it("bundle meta exposes scoring + submission depths without AI name", () => {
    const bundle = buildAiPromptBundle(wrContest, { generatedAt });
    expect(bundle.meta.fieldSize).toBe(17);
    expect(bundle.meta.scoringDepth).toBe(15);
    expect(bundle.version).toBe("RANKEYEQ_AI_WEEKLY_V6");
    expect(bundle.prompt).not.toContain("AI competitor:");
  });
});

describe("universal response merge into profile-locked boards", () => {
  const eligible = [
    { id: "a", name: "Alpha", team: "BUF" },
    { id: "b", name: "Bravo", team: "KC" },
    { id: "c", name: "Charlie", team: "SF" },
    { id: "d", name: "Delta", team: "PHI" },
    { id: "e", name: "Echo", team: "DAL" },
    { id: "f", name: "Foxtrot", team: "MIA" },
  ];

  const universalPaste = `
1. Alpha
2. Bravo
3. Charlie
4. Delta
5. Echo
6. Foxtrot
`;

  it("Claude and Gemini keep different locks while filling from the same paste", () => {
    const ordered = orderedMatchedIdsFromUniversalPaste({
      text: universalPaste,
      eligible,
    });
    expect(ordered).toEqual(["a", "b", "c", "d", "e", "f"]);

    const claude = mergeUniversalRankingIntoLockedBoard({
      submissionDepth: 6,
      lockedPicks: [{ rank: 2, rankableEntryId: "b" }],
      orderedResponseIds: ordered,
    });
    const gemini = mergeUniversalRankingIntoLockedBoard({
      submissionDepth: 6,
      lockedPicks: [{ rank: 1, rankableEntryId: "a" }],
      orderedResponseIds: ordered,
    });

    expect(claude.ok).toBe(true);
    expect(gemini.ok).toBe(true);
    if (!claude.ok || !gemini.ok) return;

    // Claude lock at #2 stays Bravo; Alpha fills first unlocked (#1).
    expect(claude.rankedEntryIds[1]).toBe("b");
    expect(claude.rankedEntryIds[0]).toBe("a");
    expect(claude.rankedEntryIds).toEqual(["a", "b", "c", "d", "e", "f"]);

    // Gemini lock at #1 stays Alpha; Bravo fills first unlocked (#2).
    expect(gemini.rankedEntryIds[0]).toBe("a");
    expect(gemini.rankedEntryIds[1]).toBe("b");
    expect(gemini.rankedEntryIds).toEqual(["a", "b", "c", "d", "e", "f"]);

    // Different lock placement with overlapping fill order still preserves each lock.
    const claudeAlt = mergeUniversalRankingIntoLockedBoard({
      submissionDepth: 4,
      lockedPicks: [{ rank: 3, rankableEntryId: "c" }],
      orderedResponseIds: ["a", "b", "c", "d", "e"],
    });
    const geminiAlt = mergeUniversalRankingIntoLockedBoard({
      submissionDepth: 4,
      lockedPicks: [{ rank: 1, rankableEntryId: "e" }],
      orderedResponseIds: ["a", "b", "c", "d", "e"],
    });
    expect(claudeAlt.ok && claudeAlt.rankedEntryIds).toEqual(["a", "b", "c", "d"]);
    expect(geminiAlt.ok && geminiAlt.rankedEntryIds).toEqual(["e", "a", "b", "c"]);
  });

  it("skips kicked-off and duplicates, truncates excess, rejects incomplete", () => {
    const merged = mergeUniversalRankingIntoLockedBoard({
      submissionDepth: 4,
      lockedPicks: [{ rank: 1, rankableEntryId: "a" }],
      orderedResponseIds: ["a", "kicked", "b", "c", "d", "e"],
      kickedOffIds: ["kicked"],
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.rankedEntryIds).toEqual(["a", "b", "c", "d"]);
    expect(merged.skippedDuplicateLocks).toBe(1);
    expect(merged.skippedKickedOff).toBe(1);
    expect(merged.truncated).toBe(1);

    const incomplete = mergeUniversalRankingIntoLockedBoard({
      submissionDepth: 4,
      lockedPicks: [{ rank: 2, rankableEntryId: "b" }],
      orderedResponseIds: ["a"],
    });
    expect(incomplete.ok).toBe(false);
    if (incomplete.ok) return;
    expect(incomplete.error).toMatch(/incomplete/i);
  });

  it("same universal prompt text is used regardless of which profile imports", () => {
    const contest: AiPromptContest = {
      title: "QB",
      seasonYear: 2026,
      sport: "NFL",
      weekLabel: "Week 2",
      weekNumber: 2,
      position: "QB",
      rankingDepth: 10,
      submissionDepth: 12,
      rankingsOpenAt: null,
      fullLockAt: null,
      players: [
        {
          name: "Alpha",
          team: "BUF",
          opponent: "vs NYJ",
          gameStartsAt: zonedLocalToUtc(2026, 9, 20, 12, 0),
          availability: "ACTIVE",
        },
      ],
      lockedSelections: [{ rank: 1, name: "Alpha", team: "BUF" }],
    };
    const forClaude = buildAiRankingPrompt(contest, {
      aiDisplayName: "Claude",
      generatedAt: zonedLocalToUtc(2026, 9, 17, 12, 0),
    });
    const forGemini = buildAiRankingPrompt(contest, {
      aiDisplayName: "Gemini",
      generatedAt: zonedLocalToUtc(2026, 9, 17, 12, 0),
    });
    expect(forClaude).toBe(forGemini);
  });
});
