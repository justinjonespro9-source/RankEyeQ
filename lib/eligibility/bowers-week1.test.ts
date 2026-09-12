import { describe, expect, it } from "vitest";
import { isSelectableAvailability } from "@/lib/eligibility/weekly-status";
import {
  buildAiRankingPrompt,
  partitionAiPromptPlayers,
} from "@/lib/admin/ai-prompt";
import { zonedLocalToUtc } from "@/lib/timing/chicago";

/**
 * Brock Bowers Week 1 fixture — OUT before kickoff, shared human/AI eligibility.
 */
describe("Brock Bowers Week 1 OUT eligibility", () => {
  const now = zonedLocalToUtc(2026, 9, 12, 9, 0);
  const kickoff = zonedLocalToUtc(2026, 9, 13, 15, 25);
  const globalLock = zonedLocalToUtc(2026, 9, 13, 10, 0);

  const bowers = {
    name: "Brock Bowers",
    team: "LV",
    opponent: "vs DEN",
    gameStartsAt: kickoff,
    availability: "OUT" as const,
    rankableEntryId: "bowers",
  };

  it("human + AI share the same OUT non-selectable rule", () => {
    expect(isSelectableAvailability("OUT")).toBe(false);
    expect(isSelectableAvailability("QUESTIONABLE")).toBe(true);
  });

  it("AI prompt lists Bowers under UNAVAILABLE and not eligible", () => {
    const contest = {
      title: "TE Top 10",
      seasonYear: 2026,
      sport: "NFL",
      weekLabel: "Week 1",
      weekNumber: 1,
      position: "TE" as const,
      rankingDepth: 10,
      submissionDepth: 12,
      rankingsOpenAt: zonedLocalToUtc(2026, 9, 8, 0, 0),
      fullLockAt: globalLock,
      players: [
        {
          name: "Trey McBride",
          team: "ARI",
          opponent: "vs LAR",
          gameStartsAt: zonedLocalToUtc(2026, 9, 13, 12, 0),
          availability: "ACTIVE" as const,
        },
        bowers,
      ],
    };
    const { eligible, unavailable } = partitionAiPromptPlayers(
      contest.players,
      now,
    );
    expect(eligible.some((p) => p.name === "Brock Bowers")).toBe(false);
    expect(unavailable.some((p) => p.name === "Brock Bowers")).toBe(true);

    const prompt = buildAiRankingPrompt(contest, { now, generatedAt: now });
    expect(prompt).toContain("UNAVAILABLE — DO NOT SELECT");
    expect(prompt).toContain("Brock Bowers");
    expect(prompt).toMatch(/Brock Bowers[\s\S]*Out/);
  });

  it("OUT + kickoff passed remains immutable for locked slots", () => {
    const afterKickoff = zonedLocalToUtc(2026, 9, 13, 16, 0);
    const contest = {
      title: "TE Top 10",
      seasonYear: 2026,
      sport: "NFL",
      weekLabel: "Week 1",
      weekNumber: 1,
      position: "TE" as const,
      rankingDepth: 10,
      submissionDepth: 12,
      rankingsOpenAt: zonedLocalToUtc(2026, 9, 8, 0, 0),
      fullLockAt: globalLock,
      players: [bowers],
      lockedSelections: [
        {
          rank: 3,
          name: "Brock Bowers",
          team: "LV",
          rankableEntryId: "bowers",
        },
      ],
    };
    const prompt = buildAiRankingPrompt(contest, {
      now: afterKickoff,
      generatedAt: afterKickoff,
      mode: "rerank-with-locks",
    });
    expect(prompt).toContain("LOCKED SELECTIONS");
    expect(prompt).toContain("#3 Brock Bowers");
    expect(prompt).toContain("Keep every locked player in the exact listed slot");
  });
});
