import { assignCompetitionRanks } from "@/lib/fantasy/competition-rank";
import { WaiverPrecisionError } from "@/lib/waivers/precision";

export type RankedWaiverPlayer<T> = { item: T; waiverRank: number; fpHundredths: number };

/**
 * Shared competition ranks (1, 1, 3) over integer fantasy-point hundredths within
 * the frozen Waiver pool. Integer equality is exact, so ties never depend on
 * float drift, names, or input order.
 */
export function rankWaiverPool<T>(
  entries: readonly T[],
  getFpHundredths: (entry: T) => number,
): RankedWaiverPlayer<T>[] {
  for (const entry of entries) {
    const value = getFpHundredths(entry);
    if (!Number.isInteger(value)) {
      throw new WaiverPrecisionError(`Waiver pool ranking requires integer hundredths (got ${value})`);
    }
  }
  return assignCompetitionRanks([...entries], getFpHundredths).map(({ item, rank, score }) => ({
    item,
    waiverRank: rank,
    fpHundredths: score,
  }));
}

export function isInWaiverResultField(waiverRank: number, resultFieldSize: number): boolean {
  return waiverRank >= 1 && waiverRank <= resultFieldSize;
}
