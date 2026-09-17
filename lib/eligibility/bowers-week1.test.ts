import { describe, expect, it } from "vitest";
import { zonedLocalToUtc } from "@/lib/timing/chicago";
import {
  buildAiRankingPrompt,
  partitionAiPromptPlayers,
  type AiPromptContest,
} from "@/lib/admin/ai-prompt";

describe("Bowers weekly availability in AI prompts (V5)", () => {
  const globalLock = zonedLocalToUtc(2026, 9, 13, 10, 0);
  const bowers = {
    name: "Brock Bowers",
    team: "LV",
    opponent: "vs NE",
    gameStartsAt: zonedLocalToUtc(2026, 9, 13, 15, 25),
    availability: "OUT" as const,
    designation: "OUT" as const,
    injuryDescription: "knee",
    rankableEntryId: "bowers",
  };

  it("lists official OUT under UNAVAILABLE — DO NOT SELECT", () => {
    const now = zonedLocalToUtc(2026, 9, 12, 12, 0);
    const contest: AiPromptContest = {
      title: "TE Top 10",
      seasonYear: 2026,
      sport: "NFL",
      weekLabel: "Week 1",
      weekNumber: 1,
      position: "TE",
      rankingDepth: 10,
      submissionDepth: 12,
      rankingsOpenAt: zonedLocalToUtc(2026, 9, 8, 0, 0),
      fullLockAt: globalLock,
      players: [bowers],
    };

    const { eligible, unavailable, kickedOff } = partitionAiPromptPlayers(
      contest.players,
      now,
    );
    expect(eligible).toHaveLength(0);
    expect(unavailable.map((p) => p.name)).toEqual(["Brock Bowers"]);
    expect(kickedOff).toHaveLength(0);

    const prompt = buildAiRankingPrompt(contest, { now, generatedAt: now });
    expect(prompt).toContain("UNAVAILABLE — DO NOT SELECT");
    expect(prompt).toContain("Brock Bowers");
    expect(prompt).toMatch(/Brock Bowers[\s\S]*OUT/);
    expect(prompt).not.toContain("LOCKED SELECTIONS");
  });

  it("ACTIVE player after kickoff is KICKED OFF, not OUT", () => {
    const afterKickoff = zonedLocalToUtc(2026, 9, 13, 16, 0);
    const activeThenKicked = {
      ...bowers,
      availability: "ACTIVE" as const,
      designation: "AVAILABLE" as const,
      injuryDescription: null,
    };
    const { eligible, unavailable, kickedOff } = partitionAiPromptPlayers(
      [activeThenKicked],
      afterKickoff,
    );
    expect(eligible).toHaveLength(0);
    expect(unavailable).toHaveLength(0);
    expect(kickedOff.map((p) => p.name)).toEqual(["Brock Bowers"]);

    const prompt = buildAiRankingPrompt(
      {
        title: "TE Top 10",
        seasonYear: 2026,
        sport: "NFL",
        weekLabel: "Week 1",
        weekNumber: 1,
        position: "TE",
        rankingDepth: 10,
        submissionDepth: 12,
        rankingsOpenAt: zonedLocalToUtc(2026, 9, 8, 0, 0),
        fullLockAt: globalLock,
        players: [activeThenKicked],
      },
      { now: afterKickoff, generatedAt: afterKickoff },
    );
    expect(prompt).toContain("KICKED OFF — CANNOT BE ADDED");
    expect(prompt).toContain("Brock Bowers");
    expect(prompt).not.toContain("LOCKED SELECTIONS");
  });
});
