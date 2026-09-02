import { describe, expect, it } from "vitest";
import { RANKIQ_TIMEZONE, zonedLocalToUtc } from "@/lib/timing/chicago";
import {
  computeNflTimingWindows,
  getWeekTimingState,
} from "@/lib/timing/week-windows";

describe("NFL week timing windows", () => {
  const thursdayKickoff = zonedLocalToUtc(2026, 9, 10, 19, 15);

  it("uses America/Chicago Tuesday open and Sunday 10am lock / noon public", () => {
    const windows = computeNflTimingWindows(thursdayKickoff);
    expect(windows.timeZone).toBe(RANKIQ_TIMEZONE);
    expect(windows.rankingsOpenAt.toISOString()).toBe(
      zonedLocalToUtc(2026, 9, 8, 0, 0).toISOString(),
    );
    expect(windows.fullLockAt.toISOString()).toBe(
      zonedLocalToUtc(2026, 9, 13, 10, 0).toISOString(),
    );
    expect(windows.revealStartsAt.toISOString()).toBe(
      windows.fullLockAt.toISOString(),
    );
    expect(windows.publicReleaseAt.toISOString()).toBe(
      zonedLocalToUtc(2026, 9, 13, 12, 0).toISOString(),
    );
  });

  it("handles CST vs CDT via America/Chicago rather than hardcoded CST", () => {
    const januaryLock = zonedLocalToUtc(2026, 1, 11, 10, 0);
    const septemberLock = zonedLocalToUtc(2026, 9, 13, 10, 0);
    expect(januaryLock.getUTCHours()).toBe(16);
    expect(septemberLock.getUTCHours()).toBe(15);
  });

  it("blocks edits before Tuesday open", () => {
    const windows = computeNflTimingWindows(thursdayKickoff);
    const state = getWeekTimingState({
      ...windows,
      now: zonedLocalToUtc(2026, 9, 7, 23, 59),
    });
    expect(state.phase).toBe("upcoming");
    expect(state.canEditUnlocked).toBe(false);
    expect(state.consensusVisible).toBe(false);
  });

  it("allows contest editing after Tuesday open", () => {
    const windows = computeNflTimingWindows(thursdayKickoff);
    const state = getWeekTimingState({
      ...windows,
      now: zonedLocalToUtc(2026, 9, 8, 0, 1),
    });
    expect(state.phase).toBe("open");
    expect(state.canEditUnlocked).toBe(true);
    expect(state.fullBoardLocked).toBe(false);
    expect(state.consensusVisible).toBe(false);
    expect(state.boardsPublic).toBe(false);
  });

  it("marks partial-lock after a kickoff has started", () => {
    const windows = computeNflTimingWindows(thursdayKickoff);
    const state = getWeekTimingState({
      ...windows,
      now: zonedLocalToUtc(2026, 9, 10, 19, 20),
      anyKickoffStarted: true,
    });
    expect(state.phase).toBe("partial-lock");
    expect(state.canEditUnlocked).toBe(true);
  });

  it("locks remaining board at Sunday 10:00 AM CT", () => {
    const windows = computeNflTimingWindows(thursdayKickoff);
    const state = getWeekTimingState({
      ...windows,
      now: zonedLocalToUtc(2026, 9, 13, 10, 0),
    });
    expect(state.fullBoardLocked).toBe(true);
    expect(state.canEditUnlocked).toBe(false);
    expect(state.consensusVisible).toBe(true);
    expect(state.revealWindowActive).toBe(true);
    expect(state.boardsPublic).toBe(false);
    expect(state.phase).toBe("reveal");
  });

  it("makes all boards public at Sunday noon CT", () => {
    const windows = computeNflTimingWindows(thursdayKickoff);
    const state = getWeekTimingState({
      ...windows,
      now: zonedLocalToUtc(2026, 9, 13, 12, 0),
    });
    expect(state.boardsPublic).toBe(true);
    expect(state.consensusVisible).toBe(true);
    expect(state.revealWindowActive).toBe(false);
    expect(state.phase).toBe("public");
  });
});
