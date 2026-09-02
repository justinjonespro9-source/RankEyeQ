import { describe, expect, it } from "vitest";
import { zonedLocalToUtc } from "@/lib/timing/chicago";
import {
  reorderAroundLockedSlots,
  validatePartialLockEdit,
} from "@/lib/timing/partial-lock";

const kickoff = zonedLocalToUtc(2026, 9, 10, 19, 15);
const before = zonedLocalToUtc(2026, 9, 10, 19, 0);
const after = zonedLocalToUtc(2026, 9, 10, 19, 20);
const openAt = zonedLocalToUtc(2026, 9, 8, 0, 0);
const sundayLock = zonedLocalToUtc(2026, 9, 13, 10, 0);

describe("partial lock edits", () => {
  it("cannot add a Thursday player after kickoff", () => {
    const result = validatePartialLockEdit({
      previous: [],
      nextRankedIds: ["gibbs", null, null],
      kickoffByEntryId: new Map([["gibbs", kickoff]]),
      now: after,
      rankingsOpenAt: openAt,
      fullLockAt: sundayLock,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/after their game has started/i);
    }
  });

  it("cannot remove a Thursday player after kickoff", () => {
    const result = validatePartialLockEdit({
      previous: [
        {
          rankableEntryId: "gibbs",
          predictedRank: 1,
          slotLocked: true,
          lockedRank: 1,
        },
      ],
      nextRankedIds: [null, "bijan", "taylor"],
      kickoffByEntryId: new Map([["gibbs", kickoff]]),
      now: after,
      rankingsOpenAt: openAt,
      fullLockAt: sundayLock,
    });
    expect(result.ok).toBe(false);
  });

  it("cannot change a Thursday player's ranking slot after kickoff", () => {
    const result = validatePartialLockEdit({
      previous: [
        {
          rankableEntryId: "gibbs",
          predictedRank: 1,
          slotLocked: true,
          lockedRank: 1,
        },
        {
          rankableEntryId: "bijan",
          predictedRank: 2,
          slotLocked: false,
          lockedRank: null,
        },
      ],
      nextRankedIds: ["bijan", "gibbs"],
      kickoffByEntryId: new Map([
        ["gibbs", kickoff],
        ["bijan", zonedLocalToUtc(2026, 9, 13, 12, 0)],
      ]),
      now: after,
      rankingsOpenAt: openAt,
      fullLockAt: sundayLock,
    });
    expect(result.ok).toBe(false);
  });

  it("lets unlocked players reorder around locked slots", () => {
    const result = validatePartialLockEdit({
      previous: [
        {
          rankableEntryId: "gibbs",
          predictedRank: 1,
          slotLocked: true,
          lockedRank: 1,
        },
        {
          rankableEntryId: "bijan",
          predictedRank: 2,
          slotLocked: false,
          lockedRank: null,
        },
        {
          rankableEntryId: "taylor",
          predictedRank: 3,
          slotLocked: false,
          lockedRank: null,
        },
      ],
      nextRankedIds: ["gibbs", "taylor", "bijan"],
      kickoffByEntryId: new Map([
        ["gibbs", kickoff],
        ["bijan", zonedLocalToUtc(2026, 9, 13, 12, 0)],
        ["taylor", zonedLocalToUtc(2026, 9, 13, 12, 0)],
      ]),
      now: after,
      rankingsOpenAt: openAt,
      fullLockAt: sundayLock,
    });
    expect(result).toEqual({ ok: true });
  });

  it("reorders only unlocked indices", () => {
    const next = reorderAroundLockedSlots(
      ["gibbs", "bijan", "taylor", "achane"],
      1,
      3,
      new Set([0]),
    );
    expect(next).toEqual(["gibbs", "taylor", "achane", "bijan"]);
  });

  it("allows adding a Thursday player before kickoff", () => {
    const result = validatePartialLockEdit({
      previous: [],
      nextRankedIds: ["gibbs"],
      kickoffByEntryId: new Map([["gibbs", kickoff]]),
      now: before,
      rankingsOpenAt: openAt,
      fullLockAt: sundayLock,
    });
    expect(result).toEqual({ ok: true });
  });

  it("locks remaining board at Sunday 10 AM CT", () => {
    const result = validatePartialLockEdit({
      previous: [
        {
          rankableEntryId: "bijan",
          predictedRank: 1,
          slotLocked: false,
          lockedRank: null,
        },
      ],
      nextRankedIds: ["taylor"],
      kickoffByEntryId: new Map([
        ["bijan", zonedLocalToUtc(2026, 9, 13, 12, 0)],
        ["taylor", zonedLocalToUtc(2026, 9, 13, 12, 0)],
      ]),
      now: sundayLock,
      rankingsOpenAt: openAt,
      fullLockAt: sundayLock,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/locked/i);
  });
});
