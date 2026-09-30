import { describe, expect, it } from "vitest";
import { toFpHundredths, WaiverPrecisionError } from "@/lib/waivers/precision";
import { isInWaiverResultField, rankWaiverPool } from "@/lib/waivers/ranking";

type Row = { id: string; name: string; fp: number };

const rows: Row[] = [
  { id: "p1", name: "Zeke Zulu", fp: 1840 },
  { id: "p2", name: "Aaron Able", fp: 1840 },
  { id: "p3", name: "Mike Middle", fp: 1200 },
  { id: "p4", name: "Bob Baker", fp: 900 },
  { id: "p5", name: "Carl Cole", fp: 900 },
  { id: "p6", name: "Dan Dent", fp: 900 },
  { id: "p7", name: "Eli East", fp: 0 },
];

function ranksById(input: Row[]) {
  return Object.fromEntries(rankWaiverPool(input, (r) => r.fp).map((r) => [r.item.id, r.waiverRank]));
}

function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe("Waiver pool ranking", () => {
  it("assigns shared competition ranks (1, 1, 3, 4, 4, 4, 7)", () => {
    expect(ranksById(rows)).toEqual({ p1: 1, p2: 1, p3: 3, p4: 4, p5: 4, p6: 4, p7: 7 });
  });

  it("is independent of input order", () => {
    const expected = ranksById(rows);
    for (let seed = 1; seed <= 25; seed += 1) {
      expect(ranksById(shuffled(rows, seed))).toEqual(expected);
    }
  });

  it("is independent of display names (never alphabetical)", () => {
    const expected = ranksById(rows);
    const renamed = rows.map((r, i) => ({ ...r, name: String.fromCharCode(90 - i).repeat(3) }));
    expect(ranksById(renamed)).toEqual(expected);
    const reversedNames = rows.map((r, i) => ({ ...r, name: rows[rows.length - 1 - i].name }));
    expect(ranksById(reversedNames)).toEqual(expected);
  });

  it("ties values that differ only by float drift once converted to hundredths", () => {
    const a = 0.1 + 0.2;
    const b = 0.3;
    expect(a === b).toBe(false);
    const ranked = rankWaiverPool(
      [
        { id: "a", fp: toFpHundredths(a) },
        { id: "b", fp: toFpHundredths(b) },
      ],
      (r) => r.fp,
    );
    expect(ranked.map((r) => r.waiverRank)).toEqual([1, 1]);
    const drift = rankWaiverPool(
      [
        { id: "x", fp: toFpHundredths(10.52 + 7.88) },
        { id: "y", fp: toFpHundredths(18.4) },
      ],
      (r) => r.fp,
    );
    expect(drift.map((r) => r.waiverRank)).toEqual([1, 1]);
  });

  it("refuses raw float points", () => {
    expect(() => rankWaiverPool([{ fp: 18.4 }], (r) => r.fp)).toThrow(WaiverPrecisionError);
  });

  it("identifies the target result field by shared rank", () => {
    expect(isInWaiverResultField(3, 3)).toBe(true);
    expect(isInWaiverResultField(4, 3)).toBe(false);
    expect(isInWaiverResultField(5, 5)).toBe(true);
    expect(isInWaiverResultField(0, 3)).toBe(false);
  });
});
