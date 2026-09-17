import { describe, expect, it } from "vitest";
import {
  immutableLockedEntryIdsFromPicks,
  kickoffLockedEntryIdsFromMap,
} from "@/lib/timing/kickoff-locks";

describe("immutableLockedEntryIdsFromPicks", () => {
  const now = new Date("2026-09-17T17:00:00.000Z");
  const future = "2026-09-20T17:00:00.000Z";
  const past = "2026-09-07T17:00:00.000Z";

  it("ignores stale slotLocked when week-scoped kickoff is still upcoming", () => {
    const ids = immutableLockedEntryIdsFromPicks({
      picks: [
        { rankableEntryId: "a", slotLocked: true },
        { rankableEntryId: "b", slotLocked: true },
      ],
      kickoffByEntryId: { a: future, b: future },
      now,
      fullBoardLocked: false,
    });
    expect(ids).toEqual([]);
  });

  it("keeps locks after week-scoped kickoff has passed", () => {
    const ids = immutableLockedEntryIdsFromPicks({
      picks: [{ rankableEntryId: "a", slotLocked: true }],
      kickoffByEntryId: { a: past },
      now,
      fullBoardLocked: false,
    });
    expect(ids).toEqual(["a"]);
  });

  it("kickoffLockedEntryIdsFromMap matches started games only", () => {
    expect(
      kickoffLockedEntryIdsFromMap({ a: past, b: future }, now),
    ).toEqual(["a"]);
  });
});
