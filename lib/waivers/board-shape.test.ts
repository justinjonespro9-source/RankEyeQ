import { describe, expect, it } from "vitest";
import { effectiveMaxCalls, validateWaiverBoardShape } from "@/lib/waivers/board-shape";

const shape = (slots: Array<string | null>, configuredMaxCalls = 3, eligiblePoolSize = 20) =>
  validateWaiverBoardShape({ slots, configuredMaxCalls, eligiblePoolSize });

describe("Waiver Podium board shape", () => {
  it("accepts contiguous boards from WIN for every depth 0..max", () => {
    expect(shape([])).toEqual({ ok: true, calls: [], callsMade: 0, availableSlots: 3 });
    expect(shape(["a"])).toMatchObject({ ok: true, callsMade: 1 });
    expect(shape(["a", "b"])).toMatchObject({ ok: true, callsMade: 2 });
    expect(shape(["a", "b", "c"])).toMatchObject({ ok: true, callsMade: 3 });
    expect(shape(["a", "b", "c", "d", "e"], 5)).toMatchObject({ ok: true, callsMade: 5 });
  });

  it("treats trailing blanks as absent, not as calls", () => {
    expect(shape(["a", null, null])).toEqual({ ok: true, calls: ["a"], callsMade: 1, availableSlots: 3 });
    expect(shape([null, null, null])).toMatchObject({ ok: true, callsMade: 0 });
    expect(validateWaiverBoardShape({ slots: ["a", "", undefined], configuredMaxCalls: 3, eligiblePoolSize: 9 })).toMatchObject({ ok: true, callsMade: 1 });
  });

  it("rejects a blank WIN with a populated PLACE", () => {
    expect(shape([null, "b"])).toMatchObject({ ok: false, errors: [{ code: "GAP", slot: 1 }] });
  });

  it("rejects a gap in the middle of the board", () => {
    expect(shape(["a", null, "c"])).toMatchObject({ ok: false, errors: [{ code: "GAP", slot: 2 }] });
    expect(shape(["a", "b", null, "d", "e"], 5)).toMatchObject({ ok: false, errors: [{ code: "GAP", slot: 3 }] });
  });

  it("rejects duplicate players", () => {
    expect(shape(["a", "a"])).toMatchObject({ ok: false, errors: [{ code: "DUPLICATE_PLAYER", slot: 2, playerId: "a" }] });
  });

  it("rejects boards deeper than the configured maximum", () => {
    expect(shape(["a", "b", "c", "d"])).toMatchObject({ ok: false, errors: [{ code: "EXCEEDS_AVAILABLE_SLOTS", slot: 4 }] });
  });

  it("caps depth at the eligible pool size", () => {
    expect(effectiveMaxCalls(3, 2)).toBe(2);
    expect(effectiveMaxCalls(5, 9)).toBe(5);
    expect(effectiveMaxCalls(3, 0)).toBe(0);
    expect(shape(["a", "b"], 3, 2)).toMatchObject({ ok: true, availableSlots: 2 });
    expect(shape(["a", "b", "c"], 3, 2)).toMatchObject({ ok: false, errors: [{ code: "EXCEEDS_AVAILABLE_SLOTS", slot: 3, availableSlots: 2 }] });
  });

  it("rejects players outside the eligible set when one is provided", () => {
    const result = validateWaiverBoardShape({
      slots: ["a", "x"],
      configuredMaxCalls: 3,
      eligiblePoolSize: 2,
      eligiblePlayerIds: new Set(["a", "b"]),
    });
    expect(result).toMatchObject({ ok: false, errors: [{ code: "INELIGIBLE_PLAYER", slot: 2, playerId: "x" }] });
  });

  it("rejects invalid depth inputs", () => {
    expect(() => effectiveMaxCalls(-1, 3)).toThrow(RangeError);
    expect(() => effectiveMaxCalls(3, 1.5)).toThrow(RangeError);
  });
});
