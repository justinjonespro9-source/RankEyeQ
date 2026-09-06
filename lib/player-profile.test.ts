import { describe, expect, it } from "vitest";
import {
  buildPlayerRecentForm,
  finishTierLabel,
  formatSelectionPct,
  highestSelectedGroup,
  opponentFromGame,
} from "@/lib/player-profile";
import { canViewCurrentWeekConsensus } from "@/lib/timing/board-access";
import { zonedLocalToUtc } from "@/lib/timing/chicago";
import { assignCompetitionRanks } from "@/lib/fantasy/competition-rank";

describe("player profile helpers", () => {
  it("builds Last 4 Weeks form with finish trend (lower is better)", () => {
    const form = buildPlayerRecentForm(
      [
        { weekNumber: 4, fantasyPoints: 20, actualRank: 3, graded: true },
        { weekNumber: 3, fantasyPoints: 12, actualRank: 8, graded: true },
        { weekNumber: 2, fantasyPoints: 18, actualRank: 5, graded: true },
        { weekNumber: 1, fantasyPoints: 10, actualRank: 12, graded: true },
        { weekNumber: 5, fantasyPoints: null, actualRank: null, graded: false },
      ],
      4,
    );
    expect(form?.label).toBe("Last 4 Weeks");
    expect(form?.weekCount).toBe(4);
    expect(form?.fantasyPpg).toBeCloseTo((20 + 12 + 18 + 10) / 4, 5);
    // newest finish 3 vs oldest in window 12 → improving
    expect(form?.finishTrend).toBe(3 - 12);
  });

  it("returns null recent form before any graded weeks", () => {
    expect(
      buildPlayerRecentForm([
        { weekNumber: 1, fantasyPoints: null, actualRank: null, graded: false },
      ]),
    ).toBeNull();
  });

  it("labels Top 3 / Top 5 / Top 10 finish tiers", () => {
    expect(finishTierLabel(1)).toBe("#1");
    expect(finishTierLabel(3)).toBe("Top 3");
    expect(finishTierLabel(5)).toBe("Top 5");
    expect(finishTierLabel(10)).toBe("Top 10");
    expect(finishTierLabel(11)).toBeNull();
  });

  it("picks highest selected group deterministically", () => {
    expect(
      highestSelectedGroup({
        all: 0.4,
        human: 0.38,
        expert: 0.09,
        creator: 0.21,
        ai: 0.12,
      }),
    ).toEqual({ key: "public", label: "Public", rate: 0.38 });

    expect(
      highestSelectedGroup({
        all: 0.2,
        human: 0.1,
        expert: 0.25,
        creator: null,
        ai: 0.12,
      })?.label,
    ).toBe("Experts");
  });

  it("formats selection percentages without fabricating zeroes as empty", () => {
    expect(formatSelectionPct(null)).toBe("—");
    expect(formatSelectionPct(0.384)).toBe("38%");
  });

  it("builds opponent labels from week game + weekTeam", () => {
    expect(
      opponentFromGame({
        weekTeam: "MIN",
        team: "MIN",
        game: { homeTeam: "CHI", awayTeam: "MIN" },
      }),
    ).toBe("vs CHI");
    expect(
      opponentFromGame({
        weekTeam: "MIN",
        team: "MIN",
        game: { homeTeam: "MIN", awayTeam: "GB" },
      }),
    ).toBe("@ GB");
  });
});

describe("competition-rank ties for player finishes", () => {
  it("assigns 1,2,2,4 when fantasy points tie", () => {
    const ranked = assignCompetitionRanks(
      [
        { id: "a", pts: 30 },
        { id: "b", pts: 22 },
        { id: "c", pts: 22 },
        { id: "d", pts: 10 },
      ],
      (row) => row.pts,
    );
    expect(ranked.map((row) => row.rank)).toEqual([1, 2, 2, 4]);
  });
});

describe("current-week market privacy on player profiles", () => {
  it("hides consensus before Sunday full lock", () => {
    const week = {
      fullLockAt: zonedLocalToUtc(2026, 9, 13, 10, 0),
      revealStartsAt: zonedLocalToUtc(2026, 9, 13, 10, 0),
      publicReleaseAt: zonedLocalToUtc(2026, 9, 13, 12, 0),
      status: "OPEN",
    };
    expect(
      canViewCurrentWeekConsensus({
        week,
        now: zonedLocalToUtc(2026, 9, 13, 9, 0),
      }),
    ).toBe(false);
    expect(
      canViewCurrentWeekConsensus({
        week,
        now: zonedLocalToUtc(2026, 9, 13, 10, 0),
      }),
    ).toBe(true);
  });
});

describe("player profile route contract", () => {
  it("keeps /players list links and dynamic player detail route", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const table = readFileSync(
      join(process.cwd(), "components/players/PlayerPerformanceTable.tsx"),
      "utf8",
    );
    expect(table).toMatch(/\/players\/\$\{/);
    const page = readFileSync(
      join(process.cwd(), "app/players/[playerId]/page.tsx"),
      "utf8",
    );
    expect(page).toContain("WhoSawItComing");
    expect(page).toContain("Season performance will populate after Week 1");
  });
});
