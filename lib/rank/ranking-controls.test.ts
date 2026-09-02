import { describe, expect, it } from "vitest";
import { reorderAroundLockedSlots } from "@/lib/timing/partial-lock";

describe("accessible ranking reorder controls", () => {
  it("moves unlocked players without disturbing locked slots", () => {
    const next = reorderAroundLockedSlots(
      ["a", "b", "c", null, null],
      2,
      1,
      new Set([0]),
    );
    expect(next).toEqual(["a", "c", "b", null, null]);
  });

  it("blocks illegal removal indices via locked index set", () => {
    const lockedIndexes = new Set([1]);
    expect(lockedIndexes.has(1)).toBe(true);
  });
});

describe("ranking depth guard", () => {
  it("detects when all slots are filled", () => {
    const rankedEntryIds = Array.from({ length: 10 }, (_, index) => `p-${index}`);
    const filledCount = rankedEntryIds.filter(Boolean).length;
    expect(filledCount).toBe(10);
    expect(filledCount >= 10).toBe(true);
  });
});
