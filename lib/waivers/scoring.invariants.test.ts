import { describe, expect, it } from "vitest";
import { effectiveMaxCalls } from "@/lib/waivers/board-shape";
import { WAIVER_MAX_CALLS, WAIVER_RESULT_FIELD_SIZE } from "@/lib/waivers/constants";
import { rankWaiverPool } from "@/lib/waivers/ranking";
import { scoreWaiverBoard, type WaiverBoardScore } from "@/lib/waivers/scoring";

/**
 * Exhaustive invariants: every contiguous board of distinct players drawn from
 * each pool below is scored and checked against the approved rules and an
 * independent exact-fraction (BigInt) reference of the formula.
 */

type Pool = { name: string; fpHundredths: number[] };

const POOLS: Pool[] = [
  { name: "10 distinct", fpHundredths: [2410, 1880, 1640, 1320, 1100, 960, 720, 400, 150, 0] },
  { name: "tie at #1", fpHundredths: [2000, 2000, 1500, 1200, 1000, 800, 600, 400] },
  { name: "tie at #2", fpHundredths: [2200, 1500, 1500, 1200, 1000, 800, 600, 400] },
  { name: "tie straddling #3/#4", fpHundredths: [2200, 1800, 1300, 1300, 900, 700, 500] },
  { name: "tie straddling #5/#6", fpHundredths: [2400, 2100, 1900, 1600, 1100, 1100, 700, 300] },
  { name: "negative and zero", fpHundredths: [1200, 800, 0, 0, -150, -300, 90] },
  { name: "all equal", fpHundredths: [1000, 1000, 1000, 1000, 1000, 1000] },
  { name: "small pool of 2", fpHundredths: [1500, 300] },
  { name: "small pool of 1", fpHundredths: [700] },
];

const CONFIGS = [
  { label: "Top-3 (QB/RB/TE/DEF)", configuredMax: WAIVER_MAX_CALLS.RB, fieldSize: WAIVER_RESULT_FIELD_SIZE.RB },
  { label: "WR Top-5", configuredMax: WAIVER_MAX_CALLS.WR, fieldSize: WAIVER_RESULT_FIELD_SIZE.WR },
];

function boards(poolSize: number, maxCalls: number): number[][] {
  const out: number[][] = [[]];
  const extend = (prefix: number[]) => {
    if (prefix.length === maxCalls) return;
    for (let i = 0; i < poolSize; i += 1) {
      if (prefix.includes(i)) continue;
      const next = [...prefix, i];
      out.push(next);
      extend(next);
    }
  };
  extend([]);
  return out;
}

const big = BigInt;
const ZERO = big(0);
const BASE = big(10);
const BONUS: Record<number, bigint> = { 1: big(20), 2: big(15), 3: big(10) };

/** Independent reference: exact fraction, round half-up to hundredths. */
function referenceHundredths(ranks: number[], fieldSize: number, availableSlots: number): number | null {
  const k = ranks.length;
  if (k === 0) return null;
  const F = big(fieldSize);
  let earned = ZERO;
  let max = ZERO;
  ranks.forEach((a, i) => {
    const slot = big(i + 1);
    const actual = big(a);
    max += BASE + F + (BONUS[i + 1] ?? ZERO);
    if (actual <= F) {
      const diff = slot > actual ? slot - actual : actual - slot;
      earned += BASE + (F - diff) + (actual === slot ? BONUS[i + 1] ?? ZERO : ZERO);
    }
  });
  const K = big(availableSlots);
  const num = earned * (big(70) * K + big(30) * big(k)) * big(100);
  const den = max * K;
  return Number((big(2) * num + den) / (big(2) * den));
}

const ceiling = (k: number, K: number) => Math.round(((70 * K + 30 * k) * 100) / K);

describe.each(CONFIGS)("Waiver EyeQ exhaustive invariants — $label", ({ configuredMax, fieldSize }) => {
  describe.each(POOLS)("pool: $name", ({ fpHundredths }) => {
    const ranked = rankWaiverPool(
      fpHundredths.map((fp, index) => ({ index, fp })),
      (row) => row.fp,
    );
    const rankOf = new Map(ranked.map((row) => [row.item.index, row.waiverRank]));
    const availableSlots = effectiveMaxCalls(configuredMax, fpHundredths.length);
    const all = boards(fpHundredths.length, availableSlots).map((picks) => {
      const ranks = picks.map((i) => rankOf.get(i)!);
      return { picks, ranks, score: scoreWaiverBoard({ actualRanksBySlot: ranks, resultFieldSize: fieldSize, availableSlots }) };
    });
    const byKey = new Map(all.map((b) => [b.picks.join(","), b]));

    it("matches the independent exact-fraction reference on every board", () => {
      for (const b of all) {
        expect(b.score.eyeqHundredths).toBe(referenceHundredths(b.ranks, fieldSize, availableSlots));
      }
    });

    it("never exceeds 100 or its perfect ceiling, and is never negative", () => {
      for (const b of all) {
        if (b.score.eyeqHundredths === null) continue;
        expect(b.score.eyeqHundredths).toBeGreaterThanOrEqual(0);
        expect(b.score.eyeqHundredths).toBeLessThanOrEqual(10000);
        expect(b.score.eyeqHundredths).toBeLessThanOrEqual(ceiling(b.score.callsMade, availableSlots));
        expect(b.score.earnedRawPoints).toBeGreaterThanOrEqual(0);
        for (const call of b.score.calls) expect(call.totalPoints).toBeGreaterThanOrEqual(0);
      }
    });

    it("gives out-of-field calls zero and bonuses only on exact slots", () => {
      for (const b of all) {
        for (const call of b.score.calls) {
          const inField = call.actualWaiverRank !== null && call.actualWaiverRank <= fieldSize;
          expect(call.inResultField).toBe(inField);
          if (!inField) expect(call.totalPoints).toBe(0);
          if (inField) expect(call.basePoints).toBe(10);
          expect(call.exactSlotHit).toBe(call.actualWaiverRank === call.slot);
          if (call.slotBonusPoints > 0) expect(call.exactSlotHit && call.slot <= 3).toBe(true);
        }
      }
    });

    it("zero calls is N/A", () => {
      const empty = byKey.get("")!;
      expect(empty.score.eyeqHundredths).toBeNull();
    });

    it("adding an out-of-field call never raises Waiver EyeQ", () => {
      for (const b of all) {
        if (b.score.callsMade === availableSlots) continue;
        for (let i = 0; i < fpHundredths.length; i += 1) {
          if (b.picks.includes(i) || rankOf.get(i)! <= fieldSize) continue;
          const extended = byKey.get([...b.picks, i].join(","))!;
          if (b.score.eyeqHundredths === null) continue;
          expect(extended.score.eyeqHundredths!).toBeLessThanOrEqual(b.score.eyeqHundredths);
        }
      }
    });

    it("is deterministic", () => {
      for (const b of all.slice(0, 500)) {
        const again: WaiverBoardScore = scoreWaiverBoard({ actualRanksBySlot: b.ranks, resultFieldSize: fieldSize, availableSlots });
        expect(again).toEqual(b.score);
      }
    });

    it("perfect boards (when achievable) hit their ceilings and rise strictly with depth", () => {
      const perfectByDepth: number[] = [];
      for (const b of all) {
        if (b.score.callsMade > 0 && b.score.allCallsExact) {
          expect(b.score.eyeqHundredths).toBe(ceiling(b.score.callsMade, availableSlots));
          perfectByDepth[b.score.callsMade] = b.score.eyeqHundredths!;
        }
      }
      const depths = perfectByDepth.map((v, k) => [k, v]).filter(([, v]) => v !== undefined);
      for (let i = 1; i < depths.length; i += 1) {
        expect(depths[i][1]).toBeGreaterThan(depths[i - 1][1]);
      }
    });
  });
});

describe("Waiver EyeQ cross-pool guarantees", () => {
  it("perfect ceilings rise strictly: Top-3 80 < 90 < 100; WR 76 < 82 < 88 < 94 < 100", () => {
    expect([1, 2, 3].map((k) => ceiling(k, 3))).toEqual([8000, 9000, 10000]);
    expect([1, 2, 3, 4, 5].map((k) => ceiling(k, 5))).toEqual([7600, 8200, 8800, 9400, 10000]);
  });

  it("with a tie at #1 no board can earn an exact PLACE", () => {
    const ranked = rankWaiverPool([2000, 2000, 1500, 1200], (fp) => fp);
    expect(ranked.map((r) => r.waiverRank)).toEqual([1, 1, 3, 4]);
    for (const b of boards(4, 3)) {
      const score = scoreWaiverBoard({
        actualRanksBySlot: b.map((i) => ranked[i].waiverRank),
        resultFieldSize: 3,
        availableSlots: 3,
      });
      expect(score.calls.some((c) => c.slot === 2 && c.exactSlotHit)).toBe(false);
    }
  });
});
