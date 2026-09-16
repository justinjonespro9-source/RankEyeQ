import { describe, expect, it } from "vitest";
import {
  LEADERBOARD_METRIC_ORDER,
  LEADERBOARD_WINNERS_HINT,
  leaderboardMetricValue,
} from "@/lib/leaderboard-row-metrics";

const sample = {
  averageScore: 87.4,
  bestScore: 94.2,
  topNHitRate: 0.7,
  exactHits: 2,
  numberOneHits: 1,
  contestsPlayed: 5,
};

describe("leaderboard row metrics", () => {
  it("orders mobile row1 Avg EYEQ / Top-N / Exact then Best / Winners / Played", () => {
    expect(LEADERBOARD_METRIC_ORDER.map((m) => m.label)).toEqual([
      "Avg EYEQ",
      "Top-N",
      "Exact",
      "Best",
      "Winners",
      "Played",
    ]);
  });

  it("renames #1 hits to Winners with accessible context", () => {
    const winners = LEADERBOARD_METRIC_ORDER.find((m) => m.key === "winners");
    expect(winners?.label).toBe("Winners");
    expect(winners?.title).toBe(LEADERBOARD_WINNERS_HINT);
    expect(LEADERBOARD_WINNERS_HINT).toMatch(/No\. 1 finishers/i);
    expect(LEADERBOARD_METRIC_ORDER.some((m) => m.label === "#1")).toBe(false);
  });

  it("keeps numberOneHits as a numeric count", () => {
    expect(leaderboardMetricValue(sample, "winners")).toBe("1");
    expect(
      leaderboardMetricValue({ ...sample, numberOneHits: 0 }, "winners"),
    ).toBe("0");
    expect(
      leaderboardMetricValue({ ...sample, numberOneHits: 3 }, "winners"),
    ).toBe("3");
  });

  it("formats the other metric values", () => {
    expect(leaderboardMetricValue(sample, "topN")).toBe("70%");
    expect(leaderboardMetricValue(sample, "exact")).toBe("2");
    expect(leaderboardMetricValue(sample, "played")).toBe("5");
    expect(leaderboardMetricValue(sample, "avg")).toMatch(/87/);
    expect(leaderboardMetricValue(sample, "best")).toMatch(/94/);
  });
});
