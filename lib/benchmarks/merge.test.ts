import { describe, expect, it } from "vitest";
import {
  isLateCapture,
  mergeSundayWithThursdayLocks,
} from "@/lib/benchmarks/merge";
import { zonedLocalToUtc } from "@/lib/timing/chicago";

const thursdayKickoff = zonedLocalToUtc(2026, 9, 10, 19, 20);
const sundayKickoff = zonedLocalToUtc(2026, 9, 13, 12, 0);
const sundayLock = zonedLocalToUtc(2026, 9, 13, 10, 0);

describe("benchmark Thursday/Sunday merge", () => {
  it("keeps a Thursday player's RankIQ slot fixed after a later Sunday snapshot", () => {
    const merged = mergeSundayWithThursdayLocks({
      rankingDepth: 3,
      now: sundayLock,
      thursday: {
        capturedAt: zonedLocalToUtc(2026, 9, 10, 12, 0),
        selected: [
          {
            rankableEntryId: "sun-a",
            sourceRank: 1,
            rankIqRank: 1,
            kickoffAt: sundayKickoff,
          },
          {
            rankableEntryId: "thu-x",
            sourceRank: 2,
            rankIqRank: 2,
            kickoffAt: thursdayKickoff,
            rawName: "Thursday X",
          },
          {
            rankableEntryId: "sun-b",
            sourceRank: 3,
            rankIqRank: 3,
            kickoffAt: sundayKickoff,
          },
        ],
      },
      sunday: {
        capturedAt: sundayLock,
        selected: [
          {
            rankableEntryId: "thu-x",
            sourceRank: 1,
            rankIqRank: 1,
            kickoffAt: thursdayKickoff,
          },
          {
            rankableEntryId: "sun-c",
            sourceRank: 2,
            rankIqRank: 2,
            kickoffAt: sundayKickoff,
          },
          {
            rankableEntryId: "sun-d",
            sourceRank: 3,
            rankIqRank: 3,
            kickoffAt: sundayKickoff,
          },
        ],
      },
    });

    expect(merged.slots[1]?.rankableEntryId).toBe("thu-x");
    expect(merged.slots[1]?.slotLocked).toBe(true);
    expect(merged.slots[1]?.rankIqRank).toBe(2);
    expect(merged.slots.map((slot) => slot?.rankableEntryId)).toEqual([
      "sun-c",
      "thu-x",
      "sun-d",
    ]);
    expect(merged.complete).toBe(true);
  });

  it("cannot add a Thursday-absent player after kickoff", () => {
    const merged = mergeSundayWithThursdayLocks({
      rankingDepth: 3,
      now: zonedLocalToUtc(2026, 9, 10, 20, 0),
      thursday: {
        capturedAt: zonedLocalToUtc(2026, 9, 10, 12, 0),
        selected: [
          {
            rankableEntryId: "sun-a",
            sourceRank: 1,
            rankIqRank: 1,
            kickoffAt: sundayKickoff,
          },
          {
            rankableEntryId: "sun-b",
            sourceRank: 2,
            rankIqRank: 2,
            kickoffAt: sundayKickoff,
          },
          {
            rankableEntryId: "sun-c",
            sourceRank: 3,
            rankIqRank: 3,
            kickoffAt: sundayKickoff,
          },
        ],
      },
      sunday: {
        capturedAt: zonedLocalToUtc(2026, 9, 10, 20, 0),
        selected: [
          {
            rankableEntryId: "thu-late",
            sourceRank: 1,
            rankIqRank: 1,
            kickoffAt: thursdayKickoff,
            rawName: "Late Thursday",
          },
          {
            rankableEntryId: "sun-a",
            sourceRank: 2,
            rankIqRank: 2,
            kickoffAt: sundayKickoff,
          },
          {
            rankableEntryId: "sun-b",
            sourceRank: 3,
            rankIqRank: 3,
            kickoffAt: sundayKickoff,
          },
          {
            rankableEntryId: "sun-c",
            sourceRank: 4,
            rankIqRank: 4,
            kickoffAt: sundayKickoff,
          },
        ],
      },
    });

    expect(
      merged.slots.some((slot) => slot?.rankableEntryId === "thu-late"),
    ).toBe(false);
    expect(merged.warnings.some((warning) => /cannot be added/.test(warning))).toBe(
      true,
    );
  });

  it("fills remaining unlocked positions from the Sunday snapshot", () => {
    const merged = mergeSundayWithThursdayLocks({
      rankingDepth: 3,
      now: sundayLock,
      thursday: {
        capturedAt: zonedLocalToUtc(2026, 9, 10, 12, 0),
        selected: [
          {
            rankableEntryId: "thu-x",
            sourceRank: 1,
            rankIqRank: 1,
            kickoffAt: thursdayKickoff,
          },
        ],
      },
      sunday: {
        capturedAt: sundayLock,
        selected: [
          {
            rankableEntryId: "sun-a",
            sourceRank: 1,
            rankIqRank: 1,
            kickoffAt: sundayKickoff,
          },
          {
            rankableEntryId: "sun-b",
            sourceRank: 2,
            rankIqRank: 2,
            kickoffAt: sundayKickoff,
          },
          {
            rankableEntryId: "thu-x",
            sourceRank: 3,
            rankIqRank: 3,
            kickoffAt: thursdayKickoff,
          },
        ],
      },
    });

    expect(merged.slots[0]?.rankableEntryId).toBe("thu-x");
    expect(merged.slots[1]?.rankableEntryId).toBe("sun-a");
    expect(merged.slots[2]?.rankableEntryId).toBe("sun-b");
    expect(merged.complete).toBe(true);
  });

  it("marks captures at or after the official lock as late", () => {
    expect(isLateCapture(sundayLock, sundayLock)).toBe(true);
    expect(
      isLateCapture(zonedLocalToUtc(2026, 9, 13, 9, 59), sundayLock),
    ).toBe(false);
  });
});
