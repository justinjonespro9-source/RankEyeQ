import { describe, expect, it } from "vitest";
import { provisionalRanksFromPoints } from "@/lib/live-rankiq";
import { scoreContest } from "@/lib/scoring";

describe("live / provisional RankIQ", () => {
  it("builds provisional standings from fantasy points with competition ranking", () => {
    const ranked = provisionalRanksFromPoints([
      { rankableEntryId: "a", fantasyPoints: 31.4 },
      { rankableEntryId: "b", fantasyPoints: 24.8 },
      { rankableEntryId: "c", fantasyPoints: 24.8 },
      { rankableEntryId: "d", fantasyPoints: 18.2 },
      { rankableEntryId: "e", fantasyPoints: null },
    ]);
    expect(ranked.map((row) => [row.item.rankableEntryId, row.rank])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 2],
      ["d", 4],
    ]);
  });

  it("computes live RankIQ separately from official normalizedScore", () => {
    const officialNormalizedScore = 88.2;
    const live = scoreContest(
      [
        {
          playerId: "a",
          playerName: "A",
          predictedRank: 1,
          actualRank: 1,
        },
        {
          playerId: "b",
          playerName: "B",
          predictedRank: 2,
          actualRank: 3,
        },
      ],
      2,
    );
    expect(live.rankIqScore).toBeGreaterThan(0);
    expect(live.rankIqScore).not.toBe(officialNormalizedScore);
  });
});
