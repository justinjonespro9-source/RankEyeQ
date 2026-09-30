import { describe, expect, it } from "vitest";
import { scoreDefenseFantasy } from "@/lib/fantasy/defense-scoring";
import { scorePlayerFantasy } from "@/lib/fantasy/player-scoring";
import {
  WaiverPrecisionError,
  divideRoundHalfAwayFromZero,
  isBelowOwnershipThreshold,
  parseRosteredPercentToBps,
  toFpHundredths,
} from "@/lib/waivers/precision";

describe("Waivers integer-hundredths precision", () => {
  it("converts canonical fantasy points to integer hundredths", () => {
    expect(toFpHundredths(18.4)).toBe(1840);
    expect(toFpHundredths(0)).toBe(0);
    expect(toFpHundredths(-0)).toBe(0);
    expect(Object.is(toFpHundredths(-0), 0)).toBe(true);
    expect(toFpHundredths(-2.3)).toBe(-230);
    expect(toFpHundredths(0.1 + 0.2)).toBe(30);
    expect(toFpHundredths(10.52 + 7.88)).toBe(1840);
  });

  it("is lossless for every Half-PPR V2 player value on a broad stat grid", () => {
    let checked = 0;
    for (let passingYards = 0; passingYards <= 450; passingYards += 7) {
      for (let receptions = 0; receptions <= 13; receptions += 1) {
        for (let yards = -9; yards <= 190; yards += 11) {
          const { fantasyPoints } = scorePlayerFantasy({
            passingYards,
            passingTds: receptions % 4,
            interceptions: receptions % 3,
            rushingYards: yards,
            rushingTds: receptions % 2,
            receptions,
            receivingYards: yards + 3,
            receivingTds: receptions % 3,
            twoPointConversions: receptions % 2,
            fumblesLost: receptions % 2,
          });
          const hundredths = toFpHundredths(fantasyPoints);
          expect(Math.abs(hundredths - fantasyPoints * 100)).toBeLessThan(1e-6);
          expect(Math.abs(hundredths % 2)).toBe(0);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });

  it("is lossless for Half-PPR V2 defense values", () => {
    for (let pointsAllowed = 0; pointsAllowed <= 45; pointsAllowed += 1) {
      for (let halfSacks = 0; halfSacks <= 16; halfSacks += 1) {
        const { fantasyPoints } = scoreDefenseFantasy({ sacks: halfSacks / 2, interceptions: halfSacks % 3, pointsAllowed, defensiveTds: pointsAllowed % 2 });
        expect(() => toFpHundredths(fantasyPoints)).not.toThrow();
      }
    }
  });

  it("fails loudly instead of silently rounding sub-hundredth values", () => {
    expect(() => toFpHundredths(18.405)).toThrow(WaiverPrecisionError);
    expect(() => toFpHundredths(Number.NaN)).toThrow(WaiverPrecisionError);
    expect(() => toFpHundredths(Number.POSITIVE_INFINITY)).toThrow(WaiverPrecisionError);
  });

  it("divides with deterministic half-away-from-zero rounding", () => {
    expect(divideRoundHalfAwayFromZero(1, 2)).toBe(1);
    expect(divideRoundHalfAwayFromZero(-1, 2)).toBe(-1);
    expect(divideRoundHalfAwayFromZero(100, 3)).toBe(33);
    expect(divideRoundHalfAwayFromZero(200, 3)).toBe(67);
    expect(Object.is(divideRoundHalfAwayFromZero(-1, 3), 0)).toBe(true);
    expect(() => divideRoundHalfAwayFromZero(1, 0)).toThrow(WaiverPrecisionError);
    expect(() => divideRoundHalfAwayFromZero(1.5, 2)).toThrow(WaiverPrecisionError);
  });
});

describe("Roster percentage basis points", () => {
  it("parses accepted formats", () => {
    expect(parseRosteredPercentToBps("49")).toEqual({ ok: true, bps: 4900 });
    expect(parseRosteredPercentToBps("49.5")).toEqual({ ok: true, bps: 4950 });
    expect(parseRosteredPercentToBps("49.50%")).toEqual({ ok: true, bps: 4950 });
    expect(parseRosteredPercentToBps(" 0.5 % ")).toEqual({ ok: true, bps: 50 });
    expect(parseRosteredPercentToBps("100")).toEqual({ ok: true, bps: 10000 });
  });

  it("rejects ambiguous or invalid formats", () => {
    expect(parseRosteredPercentToBps("")).toEqual({ ok: false, reason: "EMPTY" });
    expect(parseRosteredPercentToBps("49,5")).toEqual({ ok: false, reason: "UNPARSEABLE" });
    expect(parseRosteredPercentToBps("0.495")).toEqual({ ok: false, reason: "TOO_MANY_DECIMALS" });
    expect(parseRosteredPercentToBps("-3")).toEqual({ ok: false, reason: "UNPARSEABLE" });
    expect(parseRosteredPercentToBps("101")).toEqual({ ok: false, reason: "OUT_OF_RANGE" });
    expect(parseRosteredPercentToBps("abc")).toEqual({ ok: false, reason: "UNPARSEABLE" });
  });

  it("eligibility threshold is strictly below 50.00%", () => {
    expect(isBelowOwnershipThreshold(4999)).toBe(true);
    expect(isBelowOwnershipThreshold(4900)).toBe(true);
    expect(isBelowOwnershipThreshold(5000)).toBe(false);
    expect(isBelowOwnershipThreshold(5100)).toBe(false);
    expect(() => isBelowOwnershipThreshold(49.5)).toThrow(WaiverPrecisionError);
  });
});
