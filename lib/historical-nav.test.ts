import { describe, expect, it } from "vitest";
import {
  buildConsensusHref,
  buildMyRanksHref,
  parseContestPosition,
  resolveMyRanksDefaultWeekId,
  resolveResultsSelection,
  resultsHref,
  type HistoricalNavContest,
} from "@/lib/historical-nav";
import { opponentFromContestEntryGame } from "@/lib/week-scoped-opponent";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function contest(
  partial: Partial<HistoricalNavContest> &
    Pick<HistoricalNavContest, "id" | "weekId" | "weekNumber" | "position">,
): HistoricalNavContest {
  return {
    weekLabel: `Week ${partial.weekNumber}`,
    status: "FINAL",
    ...partial,
  };
}

const week1 = "week-1";
const week2 = "week-2";

const graded: HistoricalNavContest[] = [
  contest({ id: "c-w2-qb", weekId: week2, weekNumber: 2, position: "QB" }),
  contest({ id: "c-w2-rb", weekId: week2, weekNumber: 2, position: "RB" }),
  contest({ id: "c-w2-wr", weekId: week2, weekNumber: 2, position: "WR" }),
  contest({ id: "c-w1-qb", weekId: week1, weekNumber: 1, position: "QB" }),
  contest({ id: "c-w1-rb", weekId: week1, weekNumber: 1, position: "RB" }),
];

describe("resolveResultsSelection", () => {
  it("defaults to the most recent FINAL week and QB", () => {
    const result = resolveResultsSelection({ contests: graded });
    expect(result.selectedWeekId).toBe(week2);
    expect(result.selectedPosition).toBe("QB");
    expect(result.selectedContest?.id).toBe("c-w2-qb");
    expect(result.weeks.map((w) => w.weekNumber)).toEqual([2, 1]);
  });

  it("preserves position when switching week when that position exists", () => {
    const onRb = resolveResultsSelection({
      contests: graded,
      weekId: week2,
      position: "RB",
    });
    expect(onRb.selectedContest?.id).toBe("c-w2-rb");

    const switched = resolveResultsSelection({
      contests: graded,
      weekId: week1,
      position: "RB",
    });
    expect(switched.selectedWeekId).toBe(week1);
    expect(switched.selectedPosition).toBe("RB");
    expect(switched.selectedContest?.id).toBe("c-w1-rb");
  });

  it("falls back when preserved position is missing on the target week", () => {
    const switched = resolveResultsSelection({
      contests: graded,
      weekId: week1,
      position: "WR",
    });
    expect(switched.selectedWeekId).toBe(week1);
    expect(switched.selectedPosition).toBe("QB");
  });

  it("preserves week when switching position", () => {
    const result = resolveResultsSelection({
      contests: graded,
      weekId: week2,
      position: "RB",
    });
    expect(result.selectedWeekId).toBe(week2);
    expect(result.selectedPosition).toBe("RB");
    expect(result.selectedContest?.id).toBe("c-w2-rb");
  });

  it("accepts weekId + position deep link", () => {
    const result = resolveResultsSelection({
      contests: graded,
      weekId: week1,
      position: "qb",
    });
    expect(result.selectedContest?.id).toBe("c-w1-qb");
    expect(resultsHref({ weekId: week1, position: "QB" })).toBe(
      `/results?weekId=${week1}&position=QB`,
    );
  });

  it("still resolves existing contestId deep links", () => {
    const result = resolveResultsSelection({
      contests: graded,
      contestId: "c-w1-rb",
      weekId: week2,
      position: "QB",
    });
    expect(result.selectedContest?.id).toBe("c-w1-rb");
    expect(result.selectedWeekId).toBe(week1);
    expect(result.selectedPosition).toBe("RB");
  });
});

describe("opponentFromContestEntryGame", () => {
  it("derives opponent from ContestEntry.game even when RankableEntry.opponent is TBD", () => {
    const rankableOpponent = "TBD";
    const label = opponentFromContestEntryGame({
      team: "LAR",
      weekId: week2,
      contestGame: {
        id: "g1",
        weekId: week2,
        homeTeam: "LAR",
        awayTeam: "ATL",
        startsAt: new Date("2026-09-14T20:00:00Z"),
      },
    });
    expect(rankableOpponent).toBe("TBD");
    expect(label).toBe("vs ATL");
    expect(label).not.toBe(rankableOpponent);
  });

  it("returns TBD when ContestEntry.game is missing (no RankableEntry fallback)", () => {
    expect(
      opponentFromContestEntryGame({
        team: "LAR",
        weekId: week2,
        contestGame: null,
      }),
    ).toBe("TBD");
  });

  it("ignores games stamped for a different week", () => {
    expect(
      opponentFromContestEntryGame({
        team: "LAR",
        weekId: week2,
        contestGame: {
          id: "g-w1",
          weekId: week1,
          homeTeam: "LAR",
          awayTeam: "SEA",
          startsAt: new Date("2026-09-07T20:00:00Z"),
        },
      }),
    ).toBe("TBD");
  });
});

describe("cross-surface historical hrefs", () => {
  it("Consensus historical Your ranking board uses weekId + position", () => {
    const href = buildMyRanksHref({ weekId: week2, position: "QB" });
    expect(href).toContain(`weekId=${week2}`);
    expect(href).toContain("position=qb");
    expect(href).not.toContain("/rank/");
  });

  it("Consensus historical Results vs actual uses weekId + position", () => {
    const href = resultsHref({ weekId: week2, position: "QB" });
    expect(href).toBe(`/results?weekId=${week2}&position=QB`);
    expect(buildConsensusHref({ weekId: week2, position: "QB" })).toContain(
      `weekId=${week2}`,
    );
  });

  it("consensus page wires historical board links through weekId + position", () => {
    const source = readFileSync(
      join(process.cwd(), "app/consensus/page.tsx"),
      "utf8",
    );
    expect(source).toContain("buildMyRanksHref");
    expect(source).toContain("resultsHref");
    expect(source).not.toMatch(
      /Your ranking board[\s\S]{0,200}href=\{`\/rank\/\$\{position/,
    );
  });
});

describe("resolveMyRanksDefaultWeekId", () => {
  it("defaults to active week when user submitted there", () => {
    expect(
      resolveMyRanksDefaultWeekId({
        activeWeekId: "w3",
        submissions: [
          { weekId: "w3", weekNumber: 3 },
          { weekId: "w2", weekNumber: 2 },
        ],
      }),
    ).toBe("w3");
  });

  it("defaults to latest submitted historical week when active has none", () => {
    expect(
      resolveMyRanksDefaultWeekId({
        activeWeekId: "w3",
        submissions: [
          { weekId: "w1", weekNumber: 1 },
          { weekId: "w2", weekNumber: 2 },
        ],
      }),
    ).toBe("w2");
  });

  it("defaults to active week empty state when user never submitted", () => {
    expect(
      resolveMyRanksDefaultWeekId({
        activeWeekId: "w3",
        submissions: [],
      }),
    ).toBe("w3");
  });
});

describe("My Ranks historical empty / read-only UX", () => {
  it("historical empty state does not redirect to /rank", () => {
    const source = readFileSync(
      join(process.cwd(), "components/my-ranks/MyRanksDashboard.tsx"),
      "utf8",
    );
    expect(source).toContain("No ranking submitted for Week");
    expect(source).toContain("canEditActive");
    expect(source).toContain("isHistorical");
    // Empty-state Go to This Week is gated on canEditActive (active open week only)
    expect(source).toMatch(
      /canEditActive \? \([\s\S]*Go to This Week/,
    );
  });

  it("results page uses week + position navigation", () => {
    const source = readFileSync(
      join(process.cwd(), "app/results/page.tsx"),
      "utf8",
    );
    expect(source).toContain("resolveResultsSelection");
    expect(source).toContain('aria-label="Week"');
    expect(source).toContain('aria-label="Position"');
    expect(source).not.toContain("Week ${");
  });

  it("parseContestPosition normalizes casing", () => {
    expect(parseContestPosition("wr")).toBe("WR");
    expect(parseContestPosition("nope")).toBe("QB");
  });
});


describe("presentation sources use ContestEntry.game", () => {
  it("consensus.ts derives opponent from ContestEntry.game", () => {
    const source = readFileSync(join(process.cwd(), "lib/consensus.ts"), "utf8");
    expect(source).toContain("opponentFromContestEntryGame");
    expect(source).not.toMatch(
      /entries: contest\.entries\.map\(\(entry\) => \(\{[\s\S]{0,200}opponent: entry\.rankableEntry\.opponent/,
    );
  });

  it("player-research-queries and results-view use ContestEntry.game", () => {
    const research = readFileSync(
      join(process.cwd(), "lib/player-research-queries.ts"),
      "utf8",
    );
    const results = readFileSync(
      join(process.cwd(), "lib/results-view.ts"),
      "utf8",
    );
    const myRanks = readFileSync(join(process.cwd(), "lib/my-ranks.ts"), "utf8");
    expect(research).toContain("opponentFromContestEntryGame");
    expect(results).toContain("opponentFromContestEntryGame");
    expect(myRanks).toContain("opponentFromContestEntryGame");
  });
});
