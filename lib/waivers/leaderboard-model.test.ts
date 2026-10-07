import { describe, expect, it } from "vitest";
import {
  aggregateWaiverLeaderboard,
  formatWaiverHundredths,
  inauguralWaiverWeek,
  parseWaiverLeaderboardPosition,
  resolveWaiverLeaderboardWeek,
  waiverLeaderboardEmptyCopy,
  waiverLeaderboardState,
  waiverLeaderboardWeekOptions,
  waiverMetricValue,
  type WaiverGradedBoard,
  type WaiverLeaderboardWeek,
} from "@/lib/waivers/leaderboard-model";

const LOCK = new Date("2026-10-07T03:00:00.000Z");
const BEFORE_LOCK = new Date("2026-10-07T02:00:00.000Z");
const AFTER_LOCK = new Date("2026-10-07T04:00:00.000Z");

function week(weekNumber: number, positions: WaiverLeaderboardWeek["contests"][number]["position"][], extra: Partial<WaiverLeaderboardWeek> = {}): WaiverLeaderboardWeek {
  return {
    id: `w${weekNumber}`,
    weekNumber,
    label: `Week ${weekNumber}`,
    isTest: false,
    contests: positions.map((position) => ({ id: `c${weekNumber}${position}`, position, locksAt: LOCK })),
    ...extra,
  };
}

const ALL = ["QB", "RB", "WR", "TE", "DEF"] as const;
/** 2026: Weeks 1–4 are Rankings-only, Week 5 is the inaugural Waivers week. */
const SEASON_WEEKS = [week(1, []), week(2, []), week(3, []), week(4, []), week(5, [...ALL]), week(6, [...ALL])];

function board(p: string, weekId: string, position: WaiverGradedBoard["position"], b: Partial<WaiverGradedBoard>): WaiverGradedBoard {
  return {
    universalProfileId: p,
    weekId,
    position,
    availableSlots: 3,
    callsMade: 3,
    eyeqHundredths: 5000,
    totalFpHundredths: 3000,
    perfectCalls: 1,
    ...b,
  };
}

describe("Waivers leaderboard weeks", () => {
  it("10: no Week 4 Waivers leaderboard — weeks without Waiver contests are never options", () => {
    const options = waiverLeaderboardWeekOptions(SEASON_WEEKS);
    expect(options.map((w) => w.weekNumber)).toEqual([5, 6]);
    expect(resolveWaiverLeaderboardWeek({ options, requestedWeekNumber: 4, gradedWeekIds: new Set() })?.weekNumber).not.toBe(4);
    expect(waiverLeaderboardWeekOptions([week(4, ["QB"], { isTest: true })])).toEqual([]);
  });

  it("11: Week 5 is the inaugural Waivers week and the default before anything is graded", () => {
    const options = waiverLeaderboardWeekOptions(SEASON_WEEKS.slice(0, 5));
    expect(inauguralWaiverWeek(options)?.weekNumber).toBe(5);
    expect(resolveWaiverLeaderboardWeek({ options, requestedWeekNumber: null, gradedWeekIds: new Set() })?.weekNumber).toBe(5);
    const both = waiverLeaderboardWeekOptions(SEASON_WEEKS);
    expect(resolveWaiverLeaderboardWeek({ options: both, requestedWeekNumber: null, gradedWeekIds: new Set(["w5"]) })?.weekNumber).toBe(5);
    expect(resolveWaiverLeaderboardWeek({ options: both, requestedWeekNumber: 6, gradedWeekIds: new Set(["w5"]) })?.weekNumber).toBe(6);
  });
});

describe("Waivers leaderboard aggregation", () => {
  const boards = [
    board("a", "w5", "QB", { eyeqHundredths: 8000, totalFpHundredths: 6000, perfectCalls: 2 }),
    board("a", "w5", "WR", { availableSlots: 5, callsMade: 5, eyeqHundredths: 6000, totalFpHundredths: 5000, perfectCalls: 1 }),
    board("b", "w5", "QB", { eyeqHundredths: 6500, totalFpHundredths: 4500, perfectCalls: 0 }),
    board("a", "w6", "QB", { eyeqHundredths: 4000, totalFpHundredths: 1500, perfectCalls: 0 }),
  ];

  it("8: weekly uses one week's boards; season rolls up every graded Waivers week", () => {
    const weekly = aggregateWaiverLeaderboard(boards.filter((b) => b.weekId === "w5"));
    const a = weekly.find((r) => r.universalProfileId === "a")!;
    expect(a).toMatchObject({ played: 2, calls: 8, avgEyeqHundredths: 7000, fpPerCallHundredths: 1375, fpPerAvailableSlotHundredths: 1375, perfectCalls: 3 });
    expect(weekly.map((r) => [r.universalProfileId, r.rank])).toEqual([["a", 1], ["b", 2]]);

    const season = aggregateWaiverLeaderboard(boards);
    const aSeason = season.find((r) => r.universalProfileId === "a")!;
    expect(aSeason).toMatchObject({ played: 3, calls: 11, avgEyeqHundredths: 6000, perfectCalls: 3 });
    expect(season.map((r) => [r.universalProfileId, r.rank])).toEqual([["b", 1], ["a", 2]]);
  });

  it("8: season denominators count only actual Waivers boards — pre-launch weeks never dilute", () => {
    const season = aggregateWaiverLeaderboard([board("b", "w5", "QB", { eyeqHundredths: 7000 })]);
    expect(season[0]).toMatchObject({ played: 1, avgEyeqHundredths: 7000 });
  });

  it("9: position filters keep only that position's boards; Overall pools all positions", () => {
    const qb = aggregateWaiverLeaderboard(boards.filter((b) => b.weekId === "w5"), "QB");
    expect(qb.find((r) => r.universalProfileId === "a")).toMatchObject({ played: 1, avgEyeqHundredths: 8000 });
    const wr = aggregateWaiverLeaderboard(boards.filter((b) => b.weekId === "w5"), "WR");
    expect(wr.map((r) => r.universalProfileId)).toEqual(["a"]);
    expect(aggregateWaiverLeaderboard(boards, "DEF")).toEqual([]);
    expect(parseWaiverLeaderboardPosition("te")).toBe("TE");
    expect(parseWaiverLeaderboardPosition("K")).toBe("ALL");
    expect(parseWaiverLeaderboardPosition(undefined)).toBe("ALL");
  });

  it("13: a zero-call submitted board is N/A for WaiverEyeQ, FP/Call and Perfect, and 0.0 FP/Slot", () => {
    const [abstainer] = aggregateWaiverLeaderboard([
      board("z", "w5", "QB", { callsMade: 0, eyeqHundredths: null, totalFpHundredths: 0, perfectCalls: null }),
    ]);
    expect(abstainer).toMatchObject({ rank: null, played: 1, calls: 0, avgEyeqHundredths: null, fpPerCallHundredths: null, fpPerAvailableSlotHundredths: 0, perfectCalls: null });
    expect(waiverMetricValue(abstainer, "avgEyeq")).toBe("N/A");
    expect(waiverMetricValue(abstainer, "fpPerCall")).toBe("N/A");
    expect(waiverMetricValue(abstainer, "perfect")).toBe("N/A");
    expect(waiverMetricValue(abstainer, "fpPerSlot")).toBe("0.0");
  });

  it("13: N/A boards never count as zero in averages, but still add slots to FP/Slot", () => {
    const [row] = aggregateWaiverLeaderboard([
      board("m", "w5", "QB", { eyeqHundredths: 8000, totalFpHundredths: 3000, perfectCalls: 1 }),
      board("m", "w5", "RB", { callsMade: 0, eyeqHundredths: null, totalFpHundredths: 0, perfectCalls: null }),
    ]);
    expect(row).toMatchObject({ played: 2, calls: 3, avgEyeqHundredths: 8000, fpPerCallHundredths: 1000, fpPerAvailableSlotHundredths: 500, perfectCalls: 1, rank: 1 });
  });

  it("ties share a competition rank; unranked N/A rows follow ranked rows", () => {
    const rows = aggregateWaiverLeaderboard([
      board("x", "w5", "QB", { eyeqHundredths: 6000 }),
      board("y", "w5", "QB", { eyeqHundredths: 6000 }),
      board("w", "w5", "QB", { eyeqHundredths: 5000 }),
      board("n", "w5", "QB", { callsMade: 0, eyeqHundredths: null, totalFpHundredths: 0, perfectCalls: null }),
    ]);
    expect(rows.map((r) => [r.universalProfileId, r.rank])).toEqual([["x", 1], ["y", 1], ["w", 3], ["n", null]]);
    expect(formatWaiverHundredths(7250)).toBe("72.5");
  });
});

describe("Waivers leaderboard states", () => {
  const options = waiverLeaderboardWeekOptions(SEASON_WEEKS.slice(0, 5));
  const week5 = options[0];
  const base = { position: "ALL" as const, options, week: week5, gradedWeekIds: new Set<string>() };

  it("14: before lock the week is live; after lock it is pending grading — never zero scores", () => {
    const live = waiverLeaderboardState({ ...base, scope: "weekly", now: BEFORE_LOCK });
    expect(live).toMatchObject({ kind: "LIVE", weekLabel: "Week 5" });
    const pending = waiverLeaderboardState({ ...base, scope: "weekly", now: AFTER_LOCK });
    expect(pending).toEqual({ kind: "PENDING_GRADING", weekLabel: "Week 5" });
    if (pending.kind === "GRADED" || live.kind === "GRADED") throw new Error("unexpected");
    expect(waiverLeaderboardEmptyCopy(pending, null).title).toBe("Week 5 Waivers results will appear here after grading");
    expect(waiverLeaderboardEmptyCopy(live, "Tue, Oct 6, 10:00 PM CDT").description).toContain(
      "Week 5 Waivers results will appear here after grading.",
    );
    for (const copy of [waiverLeaderboardEmptyCopy(pending, null), waiverLeaderboardEmptyCopy(live, null)]) {
      expect(`${copy.title} ${copy.description}`.replaceAll("Week 5", "")).not.toMatch(/\d/);
    }
  });

  it("14: season is pending until the first graded Waivers week, naming the inaugural week", () => {
    const season = waiverLeaderboardState({ ...base, scope: "season", now: AFTER_LOCK });
    expect(season).toEqual({ kind: "SEASON_PENDING", inauguralWeekLabel: "Week 5" });
    expect(waiverLeaderboardState({ ...base, scope: "season", gradedWeekIds: new Set(["w5"]), now: AFTER_LOCK }).kind).toBe("GRADED");
    expect(waiverLeaderboardState({ ...base, scope: "weekly", gradedWeekIds: new Set(["w5"]), now: AFTER_LOCK }).kind).toBe("GRADED");
  });

  it("no official Waivers weeks → no board at all; a position without a contest says so", () => {
    expect(waiverLeaderboardState({ ...base, options: [], week: null, scope: "weekly", now: AFTER_LOCK }).kind).toBe("NO_WAIVERS_WEEKS");
    const qbOnly = week(5, ["QB"]);
    expect(
      waiverLeaderboardState({ ...base, options: [qbOnly], week: qbOnly, position: "DEF", scope: "weekly", now: AFTER_LOCK }).kind,
    ).toBe("NO_CONTEST");
  });

  it("15: no fabricated rows — without graded boards every Expert/AI/Human leaderboard is empty", () => {
    expect(aggregateWaiverLeaderboard([])).toEqual([]);
    expect(aggregateWaiverLeaderboard([], "QB")).toEqual([]);
  });
});
