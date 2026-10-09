import { describe, expect, it } from "vitest";
import {
  boardInWaiverCategory,
  filterWaiverBoardsByCategory,
  parseWaiverCompetitorCategory,
  waiverBoardCategory,
  waiverBoardEntryBasis,
} from "@/lib/waivers/competitor-category";
import { WAIVER_BOARD_ENTRY_BASIS_LABELS } from "@/lib/waivers/ai/constants";

const human = { id: "h", profileType: "HUMAN", authority: "OWNER_AUTHORED" };
const creator = { id: "c", profileType: "CREATOR", authority: "OWNER_AUTHORED" };
const ai = { id: "a", profileType: "AI", authority: "SYSTEM_OPERATED" };
const odd = [
  { id: "x1", profileType: "AI", authority: "OWNER_AUTHORED" },
  { id: "x2", profileType: "HUMAN", authority: "SYSTEM_OPERATED" },
  { id: "x3", profileType: "BENCHMARK", authority: "SYSTEM_OPERATED" },
  { id: "x4", profileType: "HUMAN", authority: "RANKEYEQ_CAPTURED" },
];

describe("Waiver competitor categories", () => {
  it("classifies only the two legitimate authority/profile pairs", () => {
    expect(waiverBoardCategory(human)).toBe("HUMANS");
    expect(waiverBoardCategory(creator)).toBe("HUMANS");
    expect(waiverBoardCategory(ai)).toBe("AI");
    for (const board of odd) expect(waiverBoardCategory(board), board.id).toBeNull();
  });

  it("HUMANS never includes AI boards; ALL is both; unclassified boards are never counted", () => {
    const boards = [human, ai, creator, ...odd];
    expect(filterWaiverBoardsByCategory(boards, "HUMANS").map((b) => b.id)).toEqual(["h", "c"]);
    expect(filterWaiverBoardsByCategory(boards, "AI").map((b) => b.id)).toEqual(["a"]);
    expect(filterWaiverBoardsByCategory(boards, "ALL").map((b) => b.id)).toEqual(["h", "a", "c"]);
    expect(boardInWaiverCategory(ai, "HUMANS")).toBe(false);
  });

  it("derives how a board entered: an override is never shown as a verified late entry or as on time", () => {
    expect(waiverBoardEntryBasis({ lateEntry: null, competitiveOverride: null })).toBe("ON_TIME");
    expect(waiverBoardEntryBasis({ lateEntry: {}, competitiveOverride: null })).toBe("VERIFIED_LATE_ENTRY");
    expect(waiverBoardEntryBasis({ lateEntry: null, competitiveOverride: {} })).toBe("ADMIN_COMPETITIVE_OVERRIDE");
    expect(waiverBoardEntryBasis({ lateEntry: {}, competitiveOverride: {} })).toBe("ADMIN_COMPETITIVE_OVERRIDE");
    expect(WAIVER_BOARD_ENTRY_BASIS_LABELS.ADMIN_COMPETITIVE_OVERRIDE).toBe("ADMIN COMPETITIVE OVERRIDE");
    expect(WAIVER_BOARD_ENTRY_BASIS_LABELS.ADMIN_COMPETITIVE_OVERRIDE).not.toMatch(/verified|pre-lock/i);
  });

  it("parses the category with HUMANS as the default", () => {
    expect(parseWaiverCompetitorCategory("ai")).toBe("AI");
    expect(parseWaiverCompetitorCategory("ALL")).toBe("ALL");
    expect(parseWaiverCompetitorCategory(undefined)).toBe("HUMANS");
    expect(parseWaiverCompetitorCategory("bots")).toBe("HUMANS");
  });
});
