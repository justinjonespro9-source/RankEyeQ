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

describe("Week 1 hybrid lock — SEA/NE started, Sunday still open", () => {
  const globalLock = new Date("2026-09-13T15:00:00.000Z");
  const seaNeKickoff = zonedLocalToUtc(2026, 9, 9, 19, 15); // Wed night CT
  const sundayKickoff = zonedLocalToUtc(2026, 9, 13, 12, 0);
  const afterSeaNe = zonedLocalToUtc(2026, 9, 10, 12, 0); // Thu midday CT
  const openAt = zonedLocalToUtc(2026, 9, 8, 0, 0);

  const names = new Map([
    ["jsn", "Jaxon Smith-Njigba"],
    ["dk", "DK Metcalf"],
    ["chase", "Ja'Marr Chase"],
    ["jefferson", "Justin Jefferson"],
  ]);

  function boardWithJsnAt7(overrides?: {
    next?: (string | null)[];
    now?: Date;
  }) {
    const previous = [
      { rankableEntryId: "chase", predictedRank: 1, slotLocked: false, lockedRank: null },
      { rankableEntryId: "jefferson", predictedRank: 2, slotLocked: false, lockedRank: null },
      { rankableEntryId: "wr3", predictedRank: 3, slotLocked: false, lockedRank: null },
      { rankableEntryId: "wr4", predictedRank: 4, slotLocked: false, lockedRank: null },
      { rankableEntryId: "wr5", predictedRank: 5, slotLocked: false, lockedRank: null },
      { rankableEntryId: "wr6", predictedRank: 6, slotLocked: false, lockedRank: null },
      { rankableEntryId: "jsn", predictedRank: 7, slotLocked: true, lockedRank: 7 },
      { rankableEntryId: "wr8", predictedRank: 8, slotLocked: false, lockedRank: null },
    ];
    const kickoffByEntryId = new Map<string, Date | null>([
      ["chase", sundayKickoff],
      ["jefferson", sundayKickoff],
      ["wr3", sundayKickoff],
      ["wr4", sundayKickoff],
      ["wr5", sundayKickoff],
      ["wr6", sundayKickoff],
      ["jsn", seaNeKickoff],
      ["wr8", sundayKickoff],
      ["dk", seaNeKickoff],
    ]);
    return validatePartialLockEdit({
      previous,
      nextRankedIds:
        overrides?.next ??
        previous.map((pick) => pick.rankableEntryId),
      kickoffByEntryId,
      now: overrides?.now ?? afterSeaNe,
      rankingsOpenAt: openAt,
      fullLockAt: globalLock,
      playerNamesById: names,
    });
  }

  it("keeps the board editable with JSN frozen at #7", () => {
    const result = boardWithJsnAt7();
    expect(result).toEqual({ ok: true });
  });

  it("cannot remove JSN from #7", () => {
    const next = [
      "chase",
      "jefferson",
      "wr3",
      "wr4",
      "wr5",
      "wr6",
      null,
      "wr8",
    ];
    const result = boardWithJsnAt7({ next });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Jaxon Smith-Njigba/i);
      expect(result.error).toMatch(/#7/);
    }
  });

  it("cannot move JSN from #7", () => {
    const next = [
      "chase",
      "jefferson",
      "wr3",
      "wr4",
      "wr5",
      "jsn",
      "wr6",
      "wr8",
    ];
    const result = boardWithJsnAt7({ next });
    expect(result.ok).toBe(false);
  });

  it("cannot add another SEA/NE player after kickoff", () => {
    const next = [
      "chase",
      "jefferson",
      "wr3",
      "wr4",
      "wr5",
      "wr6",
      "jsn",
      "dk",
    ];
    const result = boardWithJsnAt7({ next });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/DK Metcalf|game has started/i);
  });

  it("can remove and reorder Sunday WRs without shifting JSN", () => {
    const next = [
      "jefferson",
      "chase",
      "wr3",
      "wr4",
      "wr5",
      null,
      "jsn",
      "wr8",
    ];
    expect(boardWithJsnAt7({ next })).toEqual({ ok: true });

    const reordered = reorderAroundLockedSlots(
      ["chase", "jefferson", "wr3", "wr4", "wr5", "wr6", "jsn", "wr8"],
      0,
      1,
      new Set([6]),
    );
    expect(reordered[6]).toBe("jsn");
    expect(reordered[0]).toBe("jefferson");
    expect(reordered[1]).toBe("chase");
  });

  it("does not treat early kickoff as whole-board LOCKED before Sunday 15:00Z", () => {
    // Product rule: submission stays SUBMITTED (editable unlocked slots).
    // Full lock only at globalLock — validatePartialLockEdit still allows Sunday edits.
    expect(boardWithJsnAt7().ok).toBe(true);
    expect(afterSeaNe < globalLock).toBe(true);
  });

  it("locks every remaining slot after Sunday 15:00Z", () => {
    const result = boardWithJsnAt7({ now: globalLock });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/locked for this week/i);
  });
});
