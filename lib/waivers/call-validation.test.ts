import { describe, expect, it } from "vitest";
import { describeWaiverBoardErrors, validateWaiverCalls, type WaiverPoolEntry } from "@/lib/waivers/call-validation";

const pool = (n: number): WaiverPoolEntry[] =>
  Array.from({ length: n }, (_, i) => ({ snapshotEntryId: `se-${i + 1}`, rankableEntryId: `p${i + 1}` }));

describe("validateWaiverCalls", () => {
  it("accepts 0 through the configured maximum (Top-3 and WR Top-5)", () => {
    const top3 = pool(8);
    for (let k = 0; k <= 3; k += 1) {
      const ids = top3.slice(0, k).map((e) => e.rankableEntryId);
      const result = validateWaiverCalls({ playerIds: ids, pool: top3, configuredMaxCalls: 3 });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.calls.length).toBe(k);
    }
    const wr = pool(12);
    for (let k = 0; k <= 5; k += 1) {
      const ids = wr.slice(0, k).map((e) => e.rankableEntryId);
      expect(validateWaiverCalls({ playerIds: ids, pool: wr, configuredMaxCalls: 5 }).ok).toBe(true);
    }
  });

  it("maps each call to its frozen snapshot entry in slot order", () => {
    const result = validateWaiverCalls({ playerIds: ["p3", "p1"], pool: pool(5), configuredMaxCalls: 3 });
    expect(result).toEqual({
      ok: true,
      availableSlots: 3,
      calls: [
        { slot: 1, rankableEntryId: "p3", snapshotEntryId: "se-3" },
        { slot: 2, rankableEntryId: "p1", snapshotEntryId: "se-1" },
      ],
    });
  });

  it("an empty board is a valid zero-call shape (explicit abstention when submitted)", () => {
    for (const playerIds of [[], [null, null, null], ["", undefined]]) {
      const result = validateWaiverCalls({ playerIds, pool: pool(4), configuredMaxCalls: 3 });
      expect(result).toEqual({ ok: true, availableSlots: 3, calls: [] });
    }
  });

  it("rejects more calls than the configured maximum", () => {
    const result = validateWaiverCalls({ playerIds: ["p1", "p2", "p3", "p4"], pool: pool(8), configuredMaxCalls: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.code)).toEqual(["EXCEEDS_AVAILABLE_SLOTS"]);
  });

  it("caps depth at the eligible pool size (small pools)", () => {
    const small = pool(2);
    expect(validateWaiverCalls({ playerIds: ["p1", "p2"], pool: small, configuredMaxCalls: 3 })).toMatchObject({
      ok: true,
      availableSlots: 2,
    });
    const result = validateWaiverCalls({ playerIds: ["p1", "p2", "p1"], pool: small, configuredMaxCalls: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.code)).toContain("EXCEEDS_AVAILABLE_SLOTS");
  });

  it("rejects gaps (no PLACE without WIN, no SHOW without PLACE)", () => {
    for (const playerIds of [[null, "p1"], ["p1", null, "p2"], [undefined, undefined, "p3"]]) {
      const result = validateWaiverCalls({ playerIds, pool: pool(5), configuredMaxCalls: 3 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.map((e) => e.code)).toContain("GAP");
    }
  });

  it("rejects a duplicate player", () => {
    const result = validateWaiverCalls({ playerIds: ["p1", "p1"], pool: pool(5), configuredMaxCalls: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toEqual([{ code: "DUPLICATE_PLAYER", slot: 2, playerId: "p1" }]);
  });

  it("rejects any player outside the frozen eligible pool", () => {
    const result = validateWaiverCalls({ playerIds: ["p1", "ghost"], pool: pool(5), configuredMaxCalls: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toEqual([{ code: "INELIGIBLE_PLAYER", slot: 2, playerId: "ghost" }]);
  });

  it("describes errors for users", () => {
    expect(describeWaiverBoardErrors([{ code: "GAP", slot: 1 }])).toMatch(/no gaps/);
    expect(describeWaiverBoardErrors([{ code: "INELIGIBLE_PLAYER", slot: 1, playerId: "x" }])).toMatch(/eligible/);
    expect(describeWaiverBoardErrors([{ code: "EXCEEDS_AVAILABLE_SLOTS", slot: 4, availableSlots: 3 }])).toMatch(/at most 3/);
    expect(describeWaiverBoardErrors([{ code: "DUPLICATE_PLAYER", slot: 2, playerId: "x" }])).toMatch(/only once/);
  });
});
