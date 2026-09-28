import { describe, expect, it } from "vitest";
import {
  isCompleteOfficialBoard,
  isOfficialBoardOwnerAuthored,
  officialBoardFingerprint,
} from "@/lib/boards/official-board";

const board = (ids: string[]) =>
  ids.map((rankableEntryId, index) => ({ rankableEntryId, predictedRank: index + 1 }));
const twelve = Array.from({ length: 12 }, (_, i) => `e${i + 1}`);

describe("officialBoardFingerprint", () => {
  it("is deterministic and independent of input order", () => {
    const picks = board(twelve);
    const shuffled = [...picks].reverse();
    expect(officialBoardFingerprint({ rankingDepth: 10, reserveCount: 2, picks })).toBe(
      officialBoardFingerprint({ rankingDepth: 10, reserveCount: 2, picks: shuffled }),
    );
  });

  it("changes when ranks swap, including reserve-only changes", () => {
    const base = officialBoardFingerprint({ rankingDepth: 10, reserveCount: 2, picks: board(twelve) });
    const swapped = [...twelve];
    [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
    const reserveSwap = [...twelve];
    [reserveSwap[10], reserveSwap[11]] = [reserveSwap[11]!, reserveSwap[10]!];
    expect(officialBoardFingerprint({ rankingDepth: 10, reserveCount: 2, picks: board(swapped) })).not.toBe(base);
    expect(officialBoardFingerprint({ rankingDepth: 10, reserveCount: 2, picks: board(reserveSwap) })).not.toBe(base);
  });
});

describe("isCompleteOfficialBoard", () => {
  it("requires every slot including reserves", () => {
    expect(isCompleteOfficialBoard({ rankingDepth: 10, reserveCount: 2, picks: board(twelve) })).toBe(true);
    expect(isCompleteOfficialBoard({ rankingDepth: 10, reserveCount: 2, picks: board(twelve.slice(0, 10)) })).toBe(false);
  });

  it("rejects gaps and duplicates", () => {
    const gap = board(twelve).map((pick) => (pick.predictedRank === 5 ? { ...pick, predictedRank: 13 } : pick));
    const dup = board(twelve).map((pick) => (pick.predictedRank === 2 ? { ...pick, rankableEntryId: "e1" } : pick));
    expect(isCompleteOfficialBoard({ rankingDepth: 10, reserveCount: 2, picks: gap })).toBe(false);
    expect(isCompleteOfficialBoard({ rankingDepth: 10, reserveCount: 2, picks: dup })).toBe(false);
  });
});

describe("isOfficialBoardOwnerAuthored", () => {
  const owner = { authority: "OWNER_AUTHORED" as const, picks: [{ sourceRank: null }] };
  const captured = { authority: null, picks: [{ sourceRank: 1 }] };
  const legacyOwner = { authority: null, picks: [{ sourceRank: null }] };

  it.each([
    ["HUMAN", true, owner, true],
    ["CREATOR", true, owner, true],
    ["CREATOR", true, legacyOwner, true],
    ["HUMAN", false, owner, false],
    ["CREATOR", false, owner, false],
    ["CREATOR", true, captured, false],
    ["BENCHMARK", true, captured, false],
    ["BENCHMARK", true, owner, false],
    ["AI", true, { authority: "SYSTEM_OPERATED" as const, picks: [] }, false],
  ] as const)("%s linked=%s → %s", (profileType, hasLinkedUser, submission, expected) => {
    expect(isOfficialBoardOwnerAuthored({ profileType, hasLinkedUser, submission })).toBe(expected);
  });
});
