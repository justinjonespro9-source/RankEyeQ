import { describe, expect, it } from "vitest";
import {
  leaderboardWeekOptions,
  parseLeaderboardWeekParam,
  resolveLeaderboardWeek,
} from "@/lib/leaderboard-weeks";

const week = (weekNumber: number, status: string) => ({
  id: `w${weekNumber}`,
  weekNumber,
  status,
});

const season = [
  week(5, "OPEN"),
  week(1, "COMPLETE"),
  week(2, "COMPLETE"),
  week(3, "COMPLETE"),
  week(4, "COMPLETE"),
  week(6, "UPCOMING"),
];

describe("leaderboardWeekOptions", () => {
  it("offers started weeks in ascending order and hides UPCOMING", () => {
    expect(leaderboardWeekOptions(season).map((w) => w.weekNumber)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("includes LOCKED and ARCHIVED weeks", () => {
    expect(
      leaderboardWeekOptions([week(2, "LOCKED"), week(1, "ARCHIVED")]).map(
        (w) => w.weekNumber,
      ),
    ).toEqual([1, 2]);
  });
});

describe("parseLeaderboardWeekParam", () => {
  it("accepts positive week numbers only", () => {
    expect(parseLeaderboardWeekParam("3")).toBe(3);
    expect(parseLeaderboardWeekParam("18")).toBe(18);
    expect(parseLeaderboardWeekParam(undefined)).toBeNull();
    expect(parseLeaderboardWeekParam("")).toBeNull();
    expect(parseLeaderboardWeekParam("0")).toBeNull();
    expect(parseLeaderboardWeekParam("-1")).toBeNull();
    expect(parseLeaderboardWeekParam("2.5")).toBeNull();
    expect(parseLeaderboardWeekParam("w3")).toBeNull();
  });
});

describe("resolveLeaderboardWeek", () => {
  const options = leaderboardWeekOptions(season);

  it("honors a requested historical week", () => {
    expect(
      resolveLeaderboardWeek({
        options,
        requestedWeekNumber: 2,
        latestGradedWeekId: "w4",
        currentWeekId: "w5",
      })?.id,
    ).toBe("w2");
  });

  it("defaults to the latest graded week rather than the open week", () => {
    expect(
      resolveLeaderboardWeek({
        options,
        requestedWeekNumber: null,
        latestGradedWeekId: "w4",
        currentWeekId: "w5",
      })?.id,
    ).toBe("w4");
  });

  it("ignores a requested week that is not offered", () => {
    expect(
      resolveLeaderboardWeek({
        options,
        requestedWeekNumber: 6,
        latestGradedWeekId: "w4",
        currentWeekId: "w5",
      })?.id,
    ).toBe("w4");
  });

  it("falls back to the current week, then the latest offered week", () => {
    expect(
      resolveLeaderboardWeek({
        options,
        requestedWeekNumber: null,
        latestGradedWeekId: null,
        currentWeekId: "w5",
      })?.id,
    ).toBe("w5");
    expect(
      resolveLeaderboardWeek({
        options,
        requestedWeekNumber: null,
        latestGradedWeekId: null,
        currentWeekId: null,
      })?.id,
    ).toBe("w5");
  });

  it("returns null when no week has started", () => {
    expect(
      resolveLeaderboardWeek({
        options: [],
        requestedWeekNumber: 1,
        latestGradedWeekId: null,
        currentWeekId: "w1",
      }),
    ).toBeNull();
  });
});
