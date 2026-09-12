import { describe, expect, it } from "vitest";
import {
  contestAllowsEdits,
  contestAllowsRankingEdits,
  submissionAllowsEdits,
  submissionAllowsRankingEdits,
} from "@/lib/contest-lifecycle";
import { rankingEditWindowError } from "@/lib/timing/submission-window";
import { submissionProgressMessage } from "@/components/rank/ContestStatus";
import { canNewlySelectPlayer, canReplaceUnavailableSelection } from "@/lib/eligibility/weekly-status";
import { zonedLocalToUtc } from "@/lib/timing/chicago";

/**
 * Exact TE / Brock Bowers case: OUT before kickoff must not fully lock the board.
 */
describe("TE board editability with Bowers OUT before global lock", () => {
  const globalLock = new Date("2026-09-13T15:00:00.000Z");
  const now = zonedLocalToUtc(2026, 9, 12, 9, 0);
  const bowersKickoff = zonedLocalToUtc(2026, 9, 13, 15, 25);
  const openAt = zonedLocalToUtc(2026, 9, 8, 0, 0);

  it("does not treat premature Contest.status=LOCKED as whole-board lock", () => {
    expect(
      contestAllowsRankingEdits({
        contestStatus: "LOCKED",
        fullBoardLocked: false,
        fullLockAt: globalLock,
        now,
      }),
    ).toBe(true);
    expect(contestAllowsEdits("LOCKED")).toBe(false);
  });

  it("keeps SUBMITTED (and premature LOCKED submission) editable before fullLockAt", () => {
    expect(
      submissionAllowsRankingEdits({
        contestStatus: "LOCKED",
        submissionStatus: "SUBMITTED",
        fullBoardLocked: false,
        fullLockAt: globalLock,
        now,
      }),
    ).toBe(true);
    expect(
      submissionAllowsRankingEdits({
        contestStatus: "OPEN",
        submissionStatus: "LOCKED",
        fullBoardLocked: false,
        fullLockAt: globalLock,
        now,
      }),
    ).toBe(true);
    expect(submissionAllowsEdits("LOCKED", "SUBMITTED")).toBe(false);
  });

  it("server edit window allows saves when Contest is stale LOCKED before Sunday", () => {
    const error = rankingEditWindowError({
      contestStatus: "LOCKED",
      weekStatus: "OPEN",
      rankingsOpenAt: openAt,
      fullLockAt: globalLock,
      now,
      action: "edit",
    });
    expect(error).toBeNull();
  });

  it("blocks edits only after Week.fullLockAt", () => {
    const error = rankingEditWindowError({
      contestStatus: "OPEN",
      weekStatus: "OPEN",
      rankingsOpenAt: openAt,
      fullLockAt: globalLock,
      now: globalLock,
      action: "edit",
    });
    expect(error).toMatch(/no longer be edited|Sunday full lock/i);
  });

  it("Bowers OUT is replaceable and not newly addable; board messaging stays open", () => {
    expect(
      canNewlySelectPlayer({
        availability: "OUT",
        kickoffAt: bowersKickoff,
        now,
      }),
    ).toBe(false);
    expect(
      canReplaceUnavailableSelection({
        kickoffAt: bowersKickoff,
        now,
        fullLockAt: globalLock,
      }),
    ).toBe(true);

    expect(
      submissionProgressMessage({
        filledCount: 10,
        slotCount: 10,
        submissionStatus: "SUBMITTED",
        editable: true,
        partialKickoffLocks: true,
        fullBoardLocked: false,
      }),
    ).toMatch(/Some selections are locked/i);

    expect(
      submissionProgressMessage({
        filledCount: 10,
        slotCount: 10,
        submissionStatus: "SUBMITTED",
        editable: false,
        fullBoardLocked: true,
      }),
    ).toBe("Rankings Locked");
  });
});
