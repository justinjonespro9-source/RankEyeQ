import type { ContestPosition } from "@/lib/generated/prisma/client";

/** Waivers discipline positions (one Waiver Podium contest per week and position). */
export const WAIVER_POSITIONS = [
  "QB",
  "RB",
  "WR",
  "TE",
  "DEF",
] as const satisfies readonly ContestPosition[];

export type WaiverPosition = (typeof WAIVER_POSITIONS)[number];

/** Configured maximum calls per board. Effective depth is min(this, eligible pool size). */
export const WAIVER_MAX_CALLS: Readonly<Record<WaiverPosition, number>> = {
  QB: 3,
  RB: 3,
  WR: 5,
  TE: 3,
  DEF: 3,
};

/** Target Waiver result field: Waiver Top 3 (Top 5 for WR). */
export const WAIVER_RESULT_FIELD_SIZE: Readonly<Record<WaiverPosition, number>> = {
  QB: 3,
  RB: 3,
  WR: 5,
  TE: 3,
  DEF: 3,
};

/** Descriptive weekly maximum across all positions (3 + 3 + 5 + 3 + 3). */
export const WAIVER_WEEKLY_MAX_CALLS = WAIVER_POSITIONS.reduce(
  (sum, position) => sum + WAIVER_MAX_CALLS[position],
  0,
);

/** Slot labels by 1-based slot. */
export const WAIVER_SLOT_LABELS = ["WIN", "PLACE", "SHOW", "#4", "#5"] as const;

export type WaiverSlotLabel = (typeof WAIVER_SLOT_LABELS)[number];

/** Ownership threshold in basis points. Eligible iff rosteredBps < threshold. */
export const WAIVER_OWNERSHIP_THRESHOLD_BPS = 5000;

export type WaiverScoringConfig = {
  slug: string;
  /** Awarded when the called player finishes inside the target Waiver result field. */
  baseHitPoints: number;
  /** Exact-slot bonus by 1-based slot; slots without an entry earn no bonus. */
  exactSlotBonus: Readonly<Record<number, number>>;
  /** Coverage modifier = (floor + weight × calls / availableSlots) / 100. */
  coverageFloorPercent: number;
  coverageWeightPercent: number;
};

export const WAIVER_EYEQ_V1: WaiverScoringConfig = {
  slug: "WAIVER_EYEQ_V1",
  baseHitPoints: 10,
  exactSlotBonus: { 1: 20, 2: 15, 3: 10 },
  coverageFloorPercent: 70,
  coverageWeightPercent: 30,
};

export function waiverSlotLabel(slot: number): WaiverSlotLabel {
  const label = WAIVER_SLOT_LABELS[slot - 1];
  if (!label) throw new RangeError(`No Waiver slot ${slot}`);
  return label;
}
