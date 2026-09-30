import { describe, expect, it } from "vitest";
import { WAIVER_EYEQ_V1 } from "@/lib/waivers/constants";
import {
  WaiverScoringError,
  maxRawPointsForCalls,
  scoreWaiverBoard,
  scoreWaiverCall,
  waiverEyeqHundredths,
} from "@/lib/waivers/scoring";

const top3 = (ranks: Array<number | null>, availableSlots = 3) =>
  scoreWaiverBoard({ actualRanksBySlot: ranks, resultFieldSize: 3, availableSlots });
const wr = (ranks: Array<number | null>, availableSlots = 5) =>
  scoreWaiverBoard({ actualRanksBySlot: ranks, resultFieldSize: 5, availableSlots });

describe("Waiver EyeQ V1 — raw call scoring", () => {
  it("uses the approved constants", () => {
    expect(WAIVER_EYEQ_V1).toMatchObject({
      baseHitPoints: 10,
      exactSlotBonus: { 1: 20, 2: 15, 3: 10 },
      coverageFloorPercent: 70,
      coverageWeightPercent: 30,
    });
  });

  it("has the expected per-slot maxima", () => {
    expect([1, 2, 3].map((k) => maxRawPointsForCalls(k, 3))).toEqual([33, 61, 84]);
    expect([1, 2, 3, 4, 5].map((k) => maxRawPointsForCalls(k, 5))).toEqual([35, 65, 90, 105, 120]);
  });

  it("scores base + accuracy + exact bonus inside the field", () => {
    expect(scoreWaiverCall(1, 1, 3)).toMatchObject({ basePoints: 10, accuracyPoints: 3, slotBonusPoints: 20, totalPoints: 33, exactSlotHit: true });
    expect(scoreWaiverCall(2, 2, 3).totalPoints).toBe(28);
    expect(scoreWaiverCall(3, 3, 3).totalPoints).toBe(23);
    expect(scoreWaiverCall(4, 4, 5)).toMatchObject({ slotBonusPoints: 0, totalPoints: 15 });
    expect(scoreWaiverCall(5, 5, 5)).toMatchObject({ slotBonusPoints: 0, totalPoints: 15 });
  });

  it("exact WIN beats the same player predicted WIN but finishing PLACE", () => {
    expect(scoreWaiverCall(1, 1, 3).totalPoints).toBe(33);
    expect(scoreWaiverCall(1, 2, 3)).toMatchObject({ exactSlotHit: false, slotBonusPoints: 0, totalPoints: 12 });
  });

  it("applies the PLACE and SHOW bonuses only on exact PLACE and SHOW", () => {
    expect(scoreWaiverCall(2, 2, 3).slotBonusPoints).toBe(15);
    expect(scoreWaiverCall(2, 1, 3).slotBonusPoints).toBe(0);
    expect(scoreWaiverCall(2, 3, 3).slotBonusPoints).toBe(0);
    expect(scoreWaiverCall(3, 3, 3).slotBonusPoints).toBe(10);
    expect(scoreWaiverCall(3, 2, 3).slotBonusPoints).toBe(0);
    expect(scoreWaiverCall(1, 3, 3).slotBonusPoints).toBe(0);
  });

  it("gives an out-of-field call exactly zero: no base, accuracy or bonus, never negative", () => {
    for (const rank of [4, 5, 30, 45, 200]) {
      for (const slot of [1, 2, 3]) {
        expect(scoreWaiverCall(slot, rank, 3)).toMatchObject({
          inResultField: false,
          basePoints: 0,
          accuracyPoints: 0,
          slotBonusPoints: 0,
          totalPoints: 0,
        });
      }
    }
    expect(scoreWaiverCall(1, null, 3).totalPoints).toBe(0);
    expect(scoreWaiverCall(5, 6, 5).totalPoints).toBe(0);
  });
});

describe("Waiver EyeQ V1 — 70/30 partial-board ceilings", () => {
  it("Top-3 perfect boards reach 80 / 90 / 100", () => {
    expect(top3([1]).eyeqHundredths).toBe(8000);
    expect(top3([1, 2]).eyeqHundredths).toBe(9000);
    expect(top3([1, 2, 3]).eyeqHundredths).toBe(10000);
  });

  it("WR perfect boards reach 76 / 82 / 88 / 94 / 100", () => {
    expect([[1], [1, 2], [1, 2, 3], [1, 2, 3, 4], [1, 2, 3, 4, 5]].map((b) => wr(b).eyeqHundredths)).toEqual([
      7600, 8200, 8800, 9400, 10000,
    ]);
  });

  it("reports Call Quality separately from Waiver EyeQ", () => {
    const board = top3([1]);
    expect(board.callQuality).toEqual({ numerator: 33, denominator: 33 });
    expect(board.eyeqHundredths).toBe(8000);
  });
});

describe("Waiver EyeQ V1 — worked examples", () => {
  const cases: Array<[string, () => ReturnType<typeof top3>, number, number, number]> = [
    ["Top-3 exact WIN + two terrible misses", () => top3([1, 30, 45]), 33, 84, 3929],
    ["Top-3 exact WIN + miss", () => top3([1, 4]), 33, 61, 4869],
    ["Top-3 exact WIN + PLACE finishing 3rd", () => top3([1, 3]), 45, 61, 6639],
    ["Top-3 WIN pick finishing 2nd", () => top3([2]), 12, 33, 2909],
    ["Top-3 WIN + PLACE exact, SHOW 4th", () => top3([1, 2, 4]), 61, 84, 7262],
    ["Top-3 WIN/PLACE swapped, SHOW exact", () => top3([2, 1, 3]), 47, 84, 5595],
    ["Top-3 all in field, rotated", () => top3([2, 3, 1]), 35, 84, 4167],
    ["Top-3 three misses", () => top3([4, 5, 6]), 0, 84, 0],
    ["WR 4 exact + #5 miss", () => wr([1, 2, 3, 4, 20]), 105, 120, 8750],
    ["WR 3 exact + #4/#5 swapped", () => wr([1, 2, 3, 5, 4]), 118, 120, 9833],
    ["WR exact WIN + 4 misses", () => wr([1, 20, 21, 22, 23]), 35, 120, 2917],
    ["WR all in field, reversed", () => wr([5, 4, 3, 2, 1]), 73, 120, 6083],
  ];
  it.each(cases)("%s", (_name, run, earned, max, hundredths) => {
    const board = run();
    expect(board.earnedRawPoints).toBe(earned);
    expect(board.maxRawPoints).toBe(max);
    expect(board.eyeqHundredths).toBe(hundredths);
  });

  it("exact WIN only outperforms exact WIN plus two terrible misses", () => {
    expect(top3([1]).eyeqHundredths!).toBeGreaterThan(top3([1, 30, 45]).eyeqHundredths!);
  });

  it("an additional imperfect call may lower Waiver EyeQ (intentional under 70/30)", () => {
    expect(top3([1, 3]).eyeqHundredths!).toBeLessThan(top3([1]).eyeqHundredths!);
    expect(top3([1, 4]).eyeqHundredths!).toBeLessThan(top3([1]).eyeqHundredths!);
  });

  it("strong multi-call boards can outperform a perfect single call", () => {
    expect(top3([1, 2]).eyeqHundredths!).toBeGreaterThan(top3([1]).eyeqHundredths!);
    expect(wr([1, 2, 3, 4, 20]).eyeqHundredths!).toBeGreaterThan(wr([1]).eyeqHundredths!);
  });
});

describe("Waiver EyeQ V1 — zero calls, small pools and ties", () => {
  it("zero calls is N/A, never 0", () => {
    const board = top3([]);
    expect(board.callsMade).toBe(0);
    expect(board.eyeqHundredths).toBeNull();
    expect(board.callQuality).toBeNull();
    expect(board.allCallsExact).toBeNull();
    expect(waiverEyeqHundredths({ earnedRawPoints: 0, maxRawPoints: 0, callsMade: 0, availableSlots: 3 })).toBeNull();
  });

  it("a called player scoring zero points is still a real call", () => {
    const board = top3([4]);
    expect(board.callsMade).toBe(1);
    expect(board.eyeqHundredths).toBe(0);
  });

  it("uses effective depth: a perfect 2/2 with only two eligible players reaches 100", () => {
    expect(top3([1, 2], 2).eyeqHundredths).toBe(10000);
    expect(top3([1], 2).eyeqHundredths).toBe(8500);
    expect(top3([1], 1).eyeqHundredths).toBe(10000);
    expect(wr([1, 2, 3], 3).eyeqHundredths).toBe(10000);
  });

  it("rejects more calls than available slots", () => {
    expect(() => top3([1, 2, 3], 2)).toThrow(WaiverScoringError);
    expect(() => scoreWaiverBoard({ actualRanksBySlot: [1], resultFieldSize: 3, availableSlots: 4 })).toThrow(WaiverScoringError);
  });

  it("with shared ranks 1, 1, 3 an exact PLACE is impossible", () => {
    for (const rank of [1, 1, 3]) {
      expect(scoreWaiverCall(2, rank, 3).exactSlotHit).toBe(false);
    }
    const board = top3([1, 1]);
    expect(board.calls.map((c) => c.exactSlotHit)).toEqual([true, false]);
    expect(board.calls[1]).toMatchObject({ accuracyPoints: 2, slotBonusPoints: 0, totalPoints: 12 });
    expect(board.allCallsExact).toBe(false);
  });

  it("rejects non-integer or non-positive ranks", () => {
    expect(() => scoreWaiverCall(1, 0, 3)).toThrow(WaiverScoringError);
    expect(() => scoreWaiverCall(1, 1.5, 3)).toThrow(WaiverScoringError);
    expect(() => scoreWaiverCall(4, 1, 3)).toThrow(WaiverScoringError);
  });
});
