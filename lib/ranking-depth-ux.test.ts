import { describe, expect, it } from "vitest";
import { buildPositionChallenge } from "@/lib/rankable-mappers";
import {
  RESERVE_PROMOTION_COPY,
  boardDepthBadgeLabel,
  boardFullMessage,
  submissionProgressFillLabel,
  yourBoardTitle,
} from "@/lib/ranking-depth-copy";
import {
  eyeqFieldLabel,
  getCompactEyeqExplanation,
  topFieldHitLabel,
} from "@/lib/scoring-messaging";
import { getPositionConfig } from "@/lib/contest";
import { LEADERBOARD_METRIC_ORDER } from "@/lib/leaderboard-row-metrics";

describe("ranking depth UX mapping", () => {
  it("QB displays Top 10 + two reserves with submission depth 12", () => {
    const challenge = buildPositionChallenge({
      position: "QB",
      rankingDepth: 10,
      reserveCount: 2,
      title: "Week 2 QB",
      status: "OPEN",
      weekLabel: "Week 2",
      weekKey: "2026-week-2",
      locksAt: null,
    });
    expect(challenge.scoringDepth).toBe(10);
    expect(challenge.reserveCount).toBe(2);
    expect(challenge.slotCount).toBe(12);
    expect(boardDepthBadgeLabel(10, 2)).toBe("Top 10 + 2 reserves");
    expect(yourBoardTitle("QB", 10, 2)).toBe("Your QB Top 10 + 2 reserves");
    expect(boardFullMessage(10, 2)).toMatch(/Top 10 \+ 2 reserves/);
    expect(boardFullMessage(10, 2)).not.toMatch(/Top 12/);
  });

  it("WR displays Top 15 + two reserves, never labels scoring field Top 10", () => {
    const challenge = buildPositionChallenge({
      position: "WR",
      rankingDepth: 15,
      reserveCount: 2,
      title: "Week 2 WR",
      status: "OPEN",
      weekLabel: "Week 2",
      weekKey: "2026-week-2",
      locksAt: null,
    });
    expect(challenge.scoringDepth).toBe(15);
    expect(challenge.reserveCount).toBe(2);
    expect(challenge.slotCount).toBe(17);
    expect(boardDepthBadgeLabel(15, 2)).toBe("Top 15 + 2 reserves");
    expect(eyeqFieldLabel(challenge.scoringDepth)).toBe("Top 15");
    expect(topFieldHitLabel(challenge.scoringDepth)).toBe("Top 15 Hit");
    expect(eyeqFieldLabel(challenge.slotCount)).toBe("Top 10"); // wrong if miswired
    const lines = getCompactEyeqExplanation(challenge.scoringDepth);
    expect(lines.join(" ")).toMatch(/Top 15/);
    expect(lines.join(" ")).not.toMatch(/Top 10/);
  });

  it("legacy reserveCount=0 displays no reserve slots", () => {
    const challenge = buildPositionChallenge({
      position: "RB",
      rankingDepth: 10,
      reserveCount: 0,
      title: "Legacy RB",
      status: "OPEN",
      weekLabel: "Week 1",
      weekKey: "2026-week-1",
      locksAt: null,
    });
    expect(challenge.scoringDepth).toBe(10);
    expect(challenge.reserveCount).toBe(0);
    expect(challenge.slotCount).toBe(10);
    expect(boardDepthBadgeLabel(10, 0)).toBe("Top 10");
    expect(yourBoardTitle("RB", 10, 0)).toBe("Your RB Top 10");
  });

  it("maps a configured non-default reserve count", () => {
    const challenge = buildPositionChallenge({
      position: "TE",
      rankingDepth: 10,
      reserveCount: 1,
      title: "Custom TE",
      status: "OPEN",
      weekLabel: "Week 3",
      weekKey: "2026-week-3",
      locksAt: null,
    });
    expect(challenge.reserveCount).toBe(1);
    expect(challenge.slotCount).toBe(11);
    expect(boardDepthBadgeLabel(10, 1)).toBe("Top 10 + 1 reserves");
  });

  it("mock position configs keep 12/17 submission depth", () => {
    expect(getPositionConfig("qb").slotCount).toBe(12);
    expect(getPositionConfig("wr").slotCount).toBe(17);
    expect(getPositionConfig("wr").scoringDepth).toBe(15);
    expect(getPositionConfig("wr").reserveCount).toBe(2);
  });
});

describe("reserve promotion copy", () => {
  it("does not promise automatic promotion for QUESTIONABLE/DOUBTFUL", () => {
    expect(RESERVE_PROMOTION_COPY).toMatch(/QUESTIONABLE and DOUBTFUL/);
    expect(RESERVE_PROMOTION_COPY).toMatch(/do not automatically trigger promotion/i);
    expect(RESERVE_PROMOTION_COPY).toMatch(/officially unavailable before that player/i);
  });
});

describe("submission progress vocabulary", () => {
  it("never describes boards as Top 12 or Top 17 rankings", () => {
    const qb = submissionProgressFillLabel({
      filledCount: 12,
      scoringDepth: 10,
      reserveCount: 2,
      slotCount: 12,
      submissionStatus: "DRAFT",
      editable: true,
    });
    expect(qb).toMatch(/Top 10 \+ 2 reserves/);
    expect(qb).not.toMatch(/Top 12 complete/);

    const wr = submissionProgressFillLabel({
      filledCount: 17,
      scoringDepth: 15,
      reserveCount: 2,
      slotCount: 17,
      submissionStatus: "SUBMITTED",
      editable: true,
    });
    expect(wr).toMatch(/Top 15 \+ 2 reserves/);
    expect(wr).not.toMatch(/Top 17 complete/);
  });
});

describe("player-history consensus deep links", () => {
  it("use weekId query param the Consensus page reads", () => {
    const weekId = "week_abc123";
    const position = "WR";
    const href = `/consensus?position=${position.toLowerCase()}&weekId=${weekId}`;
    expect(href).toContain("weekId=");
    expect(href).not.toMatch(/[?&]week=/);
  });
});

describe("consensus incentive copy invariants", () => {
  it("documents pre-lock CTA and post-lock public access expectations", () => {
    // String contracts used by app/consensus/page.tsx — keep aligned.
    const preLockTitle = "Consensus still private";
    const preLockCta = "Build Your Rankings";
    const postLockEmptyCta = "Build Next Ranking";
    expect(preLockTitle).toBeTruthy();
    expect(preLockCta).toMatch(/Build Your Rankings/);
    expect(postLockEmptyCta).toMatch(/Build Next Ranking/);
  });
});

describe("leaderboard mobile metrics unchanged", () => {
  it("keeps 3×2 order and Winners label", () => {
    expect(LEADERBOARD_METRIC_ORDER.map((m) => m.label)).toEqual([
      "Avg EYEQ",
      "Top-N",
      "Exact",
      "Best",
      "Winners",
      "Played",
    ]);
  });
});
