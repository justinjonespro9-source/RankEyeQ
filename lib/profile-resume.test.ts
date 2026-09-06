import { describe, expect, it } from "vitest";
import {
  buildReceiptPickLine,
  classifyReceiptOutcome,
  formatActualFinishLabel,
} from "@/lib/profile-receipt";
import { scorePlayerPick } from "@/lib/scoring";
import {
  buildRankEyeQResume,
  groupReceiptsByWeek,
} from "@/lib/profile-resume";
import type { ProfileContestHistoryItem } from "@/types/profile";
import type { RankIQProfileStats } from "@/types/user";

function historyItem(
  partial: Partial<ProfileContestHistoryItem> &
    Pick<ProfileContestHistoryItem, "submissionId" | "weekNumber" | "position">,
): ProfileContestHistoryItem {
  return {
    contestId: "c1",
    weekLabel: `Week ${partial.weekNumber}`,
    rankingDepth: partial.position === "WR" ? 15 : 10,
    normalizedScore: 80,
    rawScore: 100,
    topNHits: 5,
    exactHits: 1,
    numberOneHit: false,
    weeklyRank: 3,
    receiptPicks: [],
    ...partial,
  };
}

const emptyStats: RankIQProfileStats = {
  overallRank: null,
  averageRankingScore: null,
  topHitRate: null,
  exactRankingHits: null,
  numberOneHits: null,
  podiumHits: null,
  bestWeek: null,
  currentStreak: null,
  positionRanks: { qb: null, rb: null, wr: null, te: null, def: null },
};

describe("receipt outcome hierarchy", () => {
  it("labels Exact over other outcomes", () => {
    const breakdown = scorePlayerPick(
      {
        playerId: "a",
        playerName: "Rico Dowdle",
        predictedRank: 4,
        actualRank: 4,
      },
      10,
    );
    expect(classifyReceiptOutcome(breakdown, 10)).toEqual({
      key: "EXACT",
      label: "EXACT",
    });
  });

  it("labels Podium Call when a Top-3 pick finishes podium", () => {
    const breakdown = scorePlayerPick(
      {
        playerId: "a",
        playerName: "Tony Pollard",
        predictedRank: 2,
        actualRank: 3,
      },
      10,
    );
    expect(breakdown.podiumCallHit).toBe(true);
    expect(classifyReceiptOutcome(breakdown, 10)).toEqual({
      key: "PODIUM_CALL",
      label: "PODIUM CALL",
    });
  });

  it("labels Top 10 Hit / Top 15 Hit for field hits that are not exact or podium calls", () => {
    const top10 = scorePlayerPick(
      {
        playerId: "a",
        playerName: "Bijan Robinson",
        predictedRank: 1,
        actualRank: 8,
      },
      10,
    );
    expect(classifyReceiptOutcome(top10, 10).label).toBe("Top 10 Hit");

    const top15 = scorePlayerPick(
      {
        playerId: "b",
        playerName: "WR Depth",
        predictedRank: 12,
        actualRank: 14,
      },
      15,
    );
    expect(classifyReceiptOutcome(top15, 15).label).toBe("Top 15 Hit");
  });

  it("labels Miss outside the scoring field", () => {
    const breakdown = scorePlayerPick(
      {
        playerId: "a",
        playerName: "Bust",
        predictedRank: 9,
        actualRank: 28,
      },
      10,
    );
    expect(classifyReceiptOutcome(breakdown, 10)).toEqual({
      key: "MISS",
      label: "Miss",
    });
  });

  it("formats actual finishes as RB2 / WR15", () => {
    expect(formatActualFinishLabel("RB", 2)).toBe("RB2");
    expect(formatActualFinishLabel("WR", 15)).toBe("WR15");
    expect(formatActualFinishLabel("QB", null)).toBe("—");
  });

  it("builds graded receipt lines with hierarchy labels", () => {
    const exact = buildReceiptPickLine({
      pick: {
        playerId: "1",
        playerName: "Rico",
        predictedRank: 4,
        actualRank: 4,
        team: "DAL",
      },
      fieldSize: 10,
      graded: true,
    });
    expect(exact.outcome.key).toBe("EXACT");

    const miss = buildReceiptPickLine({
      pick: {
        playerId: "2",
        playerName: "Bust",
        predictedRank: 9,
        actualRank: 28,
      },
      fieldSize: 10,
      graded: true,
    });
    expect(miss.outcome.key).toBe("MISS");
  });
});

describe("RankEyeQ résumé aggregates", () => {
  it("returns empty résumé without fabricating 0.0 averages", () => {
    const resume = buildRankEyeQResume({
      stats: emptyStats,
      history: [],
      contestsPlayed: 0,
    });
    expect(resume.hasGradedHistory).toBe(false);
    expect(resume.averageEyeq).toBeNull();
    expect(resume.recentForm).toBeNull();
    expect(resume.positions.every((row) => row.weeksSubmitted === 0)).toBe(true);
  });

  it("computes position weeks, averages, and Last 4 Weeks form", () => {
    const history = [
      historyItem({
        submissionId: "1",
        weekNumber: 4,
        position: "RB",
        normalizedScore: 91.4,
      }),
      historyItem({
        submissionId: "2",
        weekNumber: 4,
        position: "WR",
        normalizedScore: 70,
      }),
      historyItem({
        submissionId: "3",
        weekNumber: 3,
        position: "RB",
        normalizedScore: 80,
      }),
      historyItem({
        submissionId: "4",
        weekNumber: 2,
        position: "QB",
        normalizedScore: 60,
      }),
      historyItem({
        submissionId: "5",
        weekNumber: 1,
        position: "RB",
        normalizedScore: 50,
      }),
    ];

    const resume = buildRankEyeQResume({
      stats: {
        ...emptyStats,
        overallRank: 12,
        averageRankingScore: 70.28,
        positionRanks: { qb: 20, rb: 5, wr: 40, te: null, def: null },
        bestWeek: "Week 4 · RB · 91.4",
        exactRankingHits: 3,
        numberOneHits: 1,
        podiumHits: 2,
        topHitRate: 0.5,
      },
      history,
      contestsPlayed: 5,
    });

    expect(resume.hasGradedHistory).toBe(true);
    expect(resume.recentForm?.label).toBe("Last 4 Weeks");
    expect(resume.recentForm?.weekCount).toBe(4);

    const rb = resume.positions.find((row) => row.position === "RB");
    expect(rb?.weeksSubmitted).toBe(3);
    expect(rb?.leaderboardRank).toBe(5);
    expect(rb?.bestEyeq).toBe(91.4);
    expect(rb?.averageEyeq).toBeCloseTo((91.4 + 80 + 50) / 3, 5);

    const te = resume.positions.find((row) => row.position === "TE");
    expect(te?.weeksSubmitted).toBe(0);
    expect(te?.averageEyeq).toBeNull();
  });

  it("groups receipts by week descending", () => {
    const groups = groupReceiptsByWeek([
      historyItem({ submissionId: "a", weekNumber: 1, position: "QB" }),
      historyItem({ submissionId: "b", weekNumber: 3, position: "RB" }),
      historyItem({ submissionId: "c", weekNumber: 3, position: "WR" }),
    ]);
    expect(groups.map((g) => g.weekNumber)).toEqual([3, 1]);
    expect(groups[0].items).toHaveLength(2);
  });
});

describe("owner vs visitor profile controls (static contract)", () => {
  it("Edit profile is owner-only in ProfileHeader source", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(process.cwd(), "components/profile/ProfileHeader.tsx"),
      "utf8",
    );
    expect(source).toMatch(/isOwner \? \(/);
    expect(source).toMatch(/href=["']\/account["']/);
    expect(source).toMatch(/Edit profile/);
  });

  it("current-week locked boards do not deep-link for strangers", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(process.cwd(), "components/profile/CurrentWeekBoardsSection.tsx"),
      "utf8",
    );
    expect(source).toContain("board.allowed");
    expect(source).toMatch(/Locked|Private until reveal/);
  });
});
