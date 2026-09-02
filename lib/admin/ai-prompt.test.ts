import { describe, expect, it } from "vitest";
import { zonedLocalToUtc } from "@/lib/timing/chicago";
import { buildAiRankingPrompt, formatEligiblePlayerPool } from "@/lib/admin/ai-prompt";

describe("AI prompt generator", () => {
  const contest = {
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

  it("uses the contest pool, depth, and full PPR without consensus", () => {
    const prompt = buildAiRankingPrompt(contest);
    expect(prompt).toContain("WR Top 15");
    expect(prompt).toContain("2026 NFL");
    expect(prompt).toContain("Week 1");
    expect(prompt).toContain("Top 15");
    expect(prompt).toContain("FantasyTrack Full PPR");
    expect(prompt).toContain("Justin Jefferson");
    expect(prompt).toContain("CeeDee Lamb");
    expect(prompt).toContain("1 through 15");
    expect(prompt).not.toContain("ChatGPT");
    expect(prompt).not.toContain("average predicted");
    expect(prompt).not.toContain("% #1");
  });

  it("formats the eligible player pool independently", () => {
    const pool = formatEligiblePlayerPool(contest.players);
    expect(pool).toContain("Justin Jefferson (MIN)");
    expect(pool).toContain("CeeDee Lamb (DAL)");
  });
});
