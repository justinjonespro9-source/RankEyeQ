import { describe, expect, it } from "vitest";
import { zonedLocalToUtc } from "@/lib/timing/chicago";
import {
  computeWaiverLocksAt,
  isWaiverLocked,
  isWaiverRevealAllowed,
  resolveWaiverLocksAt,
  validateWaiverOpeningWindow,
  waiverPhaseAt,
} from "@/lib/waivers/lock-time";

const chicago = (y: number, m: number, d: number, h: number, min = 0) => zonedLocalToUtc(y, m, d, h, min);

describe("computeWaiverLocksAt — Tuesday 7:00 PM America/Chicago", () => {
  it.each([
    ["Week 1 (Thursday opener, CDT)", chicago(2026, 9, 10, 19, 20), "2026-09-09T00:00:00.000Z"],
    ["late October (CDT, before DST ends)", chicago(2026, 10, 29, 19, 15), "2026-10-28T00:00:00.000Z"],
    ["first week after DST ends (CST)", chicago(2026, 11, 5, 19, 15), "2026-11-04T01:00:00.000Z"],
    ["January (CST)", chicago(2027, 1, 9, 15, 30), "2027-01-06T01:00:00.000Z"],
  ])("%s", (_label, firstKickoff, expected) => {
    expect(computeWaiverLocksAt(firstKickoff).toISOString()).toBe(expected);
  });

  it("uses the Tuesday on or before the first kickoff's Chicago date for any weekday opener", () => {
    const expected = "2026-10-28T00:00:00.000Z";
    for (const day of [28, 29, 30, 31]) {
      expect(computeWaiverLocksAt(chicago(2026, 10, day, 12)).toISOString()).toBe(expected);
    }
    expect(computeWaiverLocksAt(chicago(2026, 11, 1, 12)).toISOString()).toBe(expected);
    expect(computeWaiverLocksAt(chicago(2026, 11, 2, 19, 15)).toISOString()).toBe(expected);
  });

  it("an 11 PM Chicago kickoff (next UTC day) still maps to its Chicago Tuesday", () => {
    expect(computeWaiverLocksAt(chicago(2026, 10, 29, 23, 30)).toISOString()).toBe("2026-10-28T00:00:00.000Z");
  });

  it("rejects an invalid kickoff", () => {
    expect(() => computeWaiverLocksAt(new Date("nope"))).toThrow(RangeError);
  });
});

describe("resolveWaiverLocksAt — no override", () => {
  it("accepts a lock strictly before the first kickoff", () => {
    expect(resolveWaiverLocksAt(chicago(2026, 10, 29, 19, 15))).toEqual({
      ok: true,
      locksAt: new Date("2026-10-28T00:00:00.000Z"),
    });
  });

  it("refuses when the first kickoff is on Tuesday at or before 7:00 PM CT", () => {
    for (const kickoff of [chicago(2026, 10, 27, 19, 0), chicago(2026, 10, 27, 12, 0)]) {
      const result = resolveWaiverLocksAt(kickoff);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("LOCK_NOT_BEFORE_FIRST_KICKOFF");
    }
  });

  it("a Tuesday kickoff after 7:00 PM CT is still valid", () => {
    expect(resolveWaiverLocksAt(chicago(2026, 10, 27, 19, 1)).ok).toBe(true);
  });
});

describe("validateWaiverOpeningWindow", () => {
  const base = {
    observedAt: new Date("2026-10-27T13:00:00Z"),
    frozenAt: new Date("2026-10-27T14:00:00Z"),
    opensAt: new Date("2026-10-27T15:00:00Z"),
    locksAt: new Date("2026-10-28T00:00:00Z"),
    firstKickoff: new Date("2026-10-30T00:15:00Z"),
  };

  it("accepts observedAt ≤ frozenAt ≤ opensAt < locksAt < first kickoff", () => {
    expect(validateWaiverOpeningWindow(base)).toEqual([]);
    expect(validateWaiverOpeningWindow({ ...base, frozenAt: base.observedAt, opensAt: base.observedAt })).toEqual([]);
  });

  it("reports each ordering violation", () => {
    expect(validateWaiverOpeningWindow({ ...base, observedAt: new Date("2026-10-27T14:30:00Z") })).toEqual([
      "OBSERVED_AFTER_FROZEN",
    ]);
    expect(validateWaiverOpeningWindow({ ...base, frozenAt: new Date("2026-10-27T15:30:00Z") })).toEqual([
      "FROZEN_AFTER_OPEN",
    ]);
    expect(validateWaiverOpeningWindow({ ...base, opensAt: base.locksAt })).toEqual(["OPEN_NOT_BEFORE_LOCK"]);
    expect(validateWaiverOpeningWindow({ ...base, firstKickoff: base.locksAt })).toEqual([
      "LOCK_NOT_BEFORE_FIRST_KICKOFF",
    ]);
  });
});

describe("clock-derived phase and reveal", () => {
  const locksAt = new Date("2026-10-28T00:00:00.000Z");

  it("is OPEN strictly before locksAt and LOCKED from the lock instant on", () => {
    expect(waiverPhaseAt(locksAt, new Date(locksAt.getTime() - 1))).toBe("OPEN");
    expect(waiverPhaseAt(locksAt, locksAt)).toBe("LOCKED");
    expect(waiverPhaseAt(locksAt, new Date(locksAt.getTime() + 1))).toBe("LOCKED");
    expect(isWaiverLocked(locksAt, locksAt)).toBe(true);
  });

  it("reveal is authorized exactly when locked (revealAt = locksAt)", () => {
    expect(isWaiverRevealAllowed(locksAt, new Date(locksAt.getTime() - 1))).toBe(false);
    expect(isWaiverRevealAllowed(locksAt, locksAt)).toBe(true);
  });
});
