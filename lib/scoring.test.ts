import { describe, expect, it } from "vitest";
import {
  getTheoreticalMaxScore,
  scoreContest,
  scorePlayerPick,
  TOP_10_MAX_RAW,
  TOP_15_MAX_RAW,
} from "@/lib/scoring";
import type { ScoreablePick } from "@/lib/scoring";

function pick(
  predictedRank: number,
  actualRank: number,
  id = `${predictedRank}-${actualRank}`,
): ScoreablePick {
  return {
    playerId: id,
    playerName: `Player ${id}`,
    predictedRank,
    actualRank,
  };
}

function perfectBoard(fieldSize: number): ScoreablePick[] {
  return Array.from({ length: fieldSize }, (_, index) => {
    const rank = index + 1;
    return pick(rank, rank, `p${rank}`);
  });
}

function board(predictedActualPairs: [number, number][]): ScoreablePick[] {
  return predictedActualPairs.map(([predicted, actual], index) =>
    pick(predicted, actual, `p${index}`),
  );
}

describe("scorePlayerPick — Top 10", () => {
  it("scores exact #1 podium call as 40", () => {
    expect(scorePlayerPick(pick(1, 1), 10)).toMatchObject({
      basePoints: 10,
      actualPodiumPoints: 20,
      podiumCallPoints: 10,
      precisionPoints: 0,
      totalPoints: 40,
      exactHit: true,
      podiumHit: true,
      podiumCallHit: true,
    });
  });

  it("scores exact #2 podium call as 35", () => {
    expect(scorePlayerPick(pick(2, 2), 10)).toMatchObject({
      totalPoints: 35,
      exactHit: true,
      podiumHit: true,
      precisionPoints: 0,
    });
  });

  it("scores exact #3 podium call as 30", () => {
    expect(scorePlayerPick(pick(3, 3), 10)).toMatchObject({
      totalPoints: 30,
      exactHit: true,
      podiumHit: true,
      precisionPoints: 0,
    });
  });

  it("scores podium #1 submitted but actual #3 as 30", () => {
    expect(scorePlayerPick(pick(1, 3), 10)).toMatchObject({
      basePoints: 10,
      actualPodiumPoints: 10,
      podiumCallPoints: 10,
      precisionPoints: 0,
      totalPoints: 30,
      exactHit: false,
      podiumHit: true,
    });
  });

  it("scores podium player actual #4, submitted #2 as 11", () => {
    expect(scorePlayerPick(pick(2, 4), 10)).toMatchObject({
      basePoints: 10,
      precisionPoints: 1,
      actualPodiumPoints: 0,
      podiumCallPoints: 0,
      totalPoints: 11,
      podiumHit: false,
    });
  });

  it("scores non-podium exact as 15", () => {
    expect(scorePlayerPick(pick(8, 8), 10)).toMatchObject({
      basePoints: 10,
      precisionPoints: 5,
      actualPodiumPoints: 0,
      podiumCallPoints: 0,
      totalPoints: 15,
      exactHit: true,
      podiumHit: false,
    });
  });

  it("scores non-podium off by 1 as 13", () => {
    expect(scorePlayerPick(pick(8, 9), 10)).toMatchObject({
      totalPoints: 13,
      precisionPoints: 3,
    });
  });

  it("scores non-podium off by 2 as 11", () => {
    expect(scorePlayerPick(pick(8, 10), 10)).toMatchObject({
      totalPoints: 11,
      precisionPoints: 1,
    });
  });

  it("scores non-podium off by 3+ as 10", () => {
    expect(scorePlayerPick(pick(8, 5), 10)).toMatchObject({
      totalPoints: 10,
      precisionPoints: 0,
    });
  });

  it("scores actual #1 ranked #4 with base + podium actual, no Podium Call", () => {
    expect(scorePlayerPick(pick(4, 1), 10)).toMatchObject({
      basePoints: 10,
      actualPodiumPoints: 20,
      podiumCallPoints: 0,
      precisionPoints: 0,
      totalPoints: 30,
      podiumHit: false,
    });
  });

  it("scores actual #2 ranked #4 with precision off by 2", () => {
    expect(scorePlayerPick(pick(4, 2), 10)).toMatchObject({
      basePoints: 10,
      actualPodiumPoints: 15,
      precisionPoints: 1,
      totalPoints: 26,
      podiumHit: false,
    });
  });

  it("awards zero when actual finish is outside Top N", () => {
    expect(scorePlayerPick(pick(5, 18), 10)).toMatchObject({
      totalPoints: 0,
      topNHit: false,
      exactHit: false,
      podiumHit: false,
    });
  });

  it("treats tied actual rank as exact hit for profile stats", () => {
    const result = scorePlayerPick(pick(2, 2, "tied"), 10);
    expect(result.exactHit).toBe(true);
    expect(result.podiumHit).toBe(true);
    expect(result.totalPoints).toBe(35);
  });

  it("does not award actual #3 bonus when competition ranking skips #3", () => {
    const result = scorePlayerPick(pick(2, 4, "skipped-show"), 10);
    expect(result.actualPodiumPoints).toBe(0);
    expect(result.podiumCallPoints).toBe(0);
    expect(result.precisionPoints).toBe(1);
    expect(result.totalPoints).toBe(11);
  });
});

describe("scoreContest — Top 10", () => {
  it("grades a perfect Top-10 ranking to 210 raw / 100 EYEQ", () => {
    const summary = scoreContest(perfectBoard(10), 10);
    expect(summary.rawPoints).toBe(TOP_10_MAX_RAW);
    expect(summary.maxPoints).toBe(210);
    expect(summary.rankIqScore).toBe(100);
    expect(summary.topNHits).toBe(10);
    expect(summary.exactHits).toBe(10);
    expect(summary.podiumHits).toBe(3);
    expect(summary.withinTwoHits).toBe(10);
  });

  it("perfect podium with shuffled Top-3 order still maxes out", () => {
    const shuffledPodium = board([
      [2, 1],
      [1, 2],
      [3, 3],
      [4, 4],
      [5, 5],
      [6, 6],
      [7, 7],
      [8, 8],
      [9, 9],
      [10, 10],
    ]);
    const summary = scoreContest(shuffledPodium, 10);
    expect(summary.rawPoints).toBe(210);
    expect(summary.rankIqScore).toBe(100);
    expect(summary.podiumHits).toBe(3);
    expect(summary.exactHits).toBe(8);
  });

  it("handles partial Top-N identification", () => {
    const picks = [
      pick(1, 1, "a"),
      pick(2, 12, "b"),
      pick(3, 3, "c"),
      pick(4, 8, "d"),
      pick(5, 20, "e"),
      pick(6, 6, "f"),
      pick(7, 15, "g"),
      pick(8, 9, "h"),
      pick(9, 11, "i"),
      pick(10, 2, "j"),
    ];

    const summary = scoreContest(picks, 10);
    expect(summary.topNHits).toBe(6);
    expect(summary.exactHits).toBe(3);
    expect(summary.podiumHits).toBe(2);
    expect(summary.rankIqScore).toBeLessThan(100);
  });
});

describe("scoreContest — Top 15 WR", () => {
  it("grades a perfect WR Top-15 ranking to 285 raw / 100 EYEQ", () => {
    const summary = scoreContest(perfectBoard(15), 15);
    expect(summary.rawPoints).toBe(TOP_15_MAX_RAW);
    expect(summary.maxPoints).toBe(285);
    expect(summary.rankIqScore).toBe(100);
    expect(summary.topNHits).toBe(15);
    expect(summary.podiumHits).toBe(3);
  });

  it("uses the same precision/podium rules in Top 15", () => {
    const wrBoard = board([
      [1, 1],
      [2, 2],
      [3, 3],
      [8, 8],
      [9, 10],
      [10, 9],
      [11, 11],
      [12, 15],
      [13, 13],
      [14, 14],
      [15, 12],
      [4, 4],
      [5, 5],
      [6, 6],
      [7, 7],
    ]);
    const summary = scoreContest(wrBoard, 15);
    expect(summary.topNHits).toBe(15);
    expect(summary.podiumHits).toBe(3);
    expect(summary.exactHits).toBe(11);
    expect(summary.withinTwoHits).toBe(13);
  });
});

describe("getTheoreticalMaxScore", () => {
  it("computes Top-10 max as 210", () => {
    expect(getTheoreticalMaxScore(10)).toBe(210);
  });

  it("computes Top-15 max as 285", () => {
    expect(getTheoreticalMaxScore(15)).toBe(285);
  });
});

describe("consensus confidence metrics helpers", () => {
  it("derives Rank % and Podium % from eligible submitted boards only", () => {
    const eligibleBoards = [
      { ranks: { a: 1, b: 2, c: 3 } },
      { ranks: { a: 2, b: 4, d: 5 } },
      { ranks: { a: 3, e: 6 } },
      { ranks: { b: 1, c: 2 } },
    ];
    const sampleSize = eligibleBoards.length;

    const rankCounts = new Map<string, number>();
    const podiumCounts = new Map<string, number>();
    const rankSums = new Map<string, number>();

    for (const boardRow of eligibleBoards) {
      for (const [playerId, rank] of Object.entries(boardRow.ranks)) {
        rankCounts.set(playerId, (rankCounts.get(playerId) ?? 0) + 1);
        rankSums.set(playerId, (rankSums.get(playerId) ?? 0) + rank);
        if (rank <= 3) {
          podiumCounts.set(playerId, (podiumCounts.get(playerId) ?? 0) + 1);
        }
      }
    }

    expect((rankCounts.get("a") ?? 0) / sampleSize).toBe(0.75);
    expect((podiumCounts.get("a") ?? 0) / sampleSize).toBe(0.75);
    expect((rankCounts.get("b") ?? 0) / sampleSize).toBe(0.75);
    expect((podiumCounts.get("b") ?? 0) / sampleSize).toBe(0.5);
    expect((rankSums.get("a") ?? 0) / (rankCounts.get("a") ?? 1)).toBe(2);
  });
});
