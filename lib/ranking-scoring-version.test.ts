import { describe, expect, it } from "vitest";
import { getDefaultRankingScoringConfig } from "@/lib/ranking-scoring-version";
import { scoreContest } from "@/lib/scoring";

describe("ranking scoring version integrity", () => {
  it("scores identically with default V1 config and legacy constants", () => {
    const picks = Array.from({ length: 10 }, (_, index) => ({
      playerId: `p${index + 1}`,
      playerName: `Player ${index + 1}`,
      predictedRank: index + 1,
      actualRank: index + 1,
    }));

    const baseline = scoreContest(picks, 10);
    const versioned = scoreContest(picks, 10, getDefaultRankingScoringConfig());

    expect(versioned.rawPoints).toBe(baseline.rawPoints);
    expect(versioned.rankIqScore).toBe(baseline.rankIqScore);
  });

  it("allows alternate config without changing default production constants", () => {
    const config = getDefaultRankingScoringConfig();
    const modified = { ...config, baseHitPoints: 12 };
    const picks = [
      {
        playerId: "p1",
        playerName: "P1",
        predictedRank: 1,
        actualRank: 1,
      },
    ];

    const defaultScore = scoreContest(picks, 10, config);
    const modifiedScore = scoreContest(picks, 10, modified);

    expect(modifiedScore.rawPoints).toBeGreaterThan(defaultScore.rawPoints);
  });
});
