import { WAIVER_EYEQ_V1, type WaiverScoringConfig } from "@/lib/waivers/constants";

/**
 * Waiver EyeQ V1 — pure, integer-only scoring for one Waiver Podium board.
 *
 *   in field (1 ≤ a ≤ F):  p = base + (F − |slot − a|) + [a = slot]·bonus(slot)
 *   outside the field:     p = 0   (no base, no accuracy, no bonus; never negative)
 *   M_k   = Σ_{slot ≤ k} (base + F + bonus(slot))
 *   EyeQ  = 100 · (Σp / M_k) · (floor + weight · k / K) / 100,   K = available slots
 *   k = 0 → N/A
 *
 * Ranks are shared competition ranks (1, 1, 3): with a tie at #1 there is no
 * actual #2, so an exact PLACE is impossible. Slots are never re-sequenced.
 */

export class WaiverScoringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WaiverScoringError";
  }
}

export type WaiverCallScore = {
  slot: number;
  /** Shared Waiver Pool Rank of the called player; null when unranked. */
  actualWaiverRank: number | null;
  inResultField: boolean;
  exactSlotHit: boolean;
  basePoints: number;
  accuracyPoints: number;
  slotBonusPoints: number;
  totalPoints: number;
};

export type WaiverBoardScore = {
  scoringVersion: string;
  callsMade: number;
  availableSlots: number;
  resultFieldSize: number;
  calls: WaiverCallScore[];
  earnedRawPoints: number;
  maxRawPoints: number;
  /** earned / max for the calls actually made; null when no calls. */
  callQuality: { numerator: number; denominator: number } | null;
  /** Waiver EyeQ in integer hundredths (0..10000); null = N/A (zero calls). */
  eyeqHundredths: number | null;
  allCallsExact: boolean | null;
};

function assertPositiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value < 1) {
    throw new WaiverScoringError(`${name} must be a positive integer (got ${value})`);
  }
}

function slotBonus(slot: number, config: WaiverScoringConfig): number {
  return config.exactSlotBonus[slot] ?? 0;
}

export function maxRawPointsForSlot(
  slot: number,
  resultFieldSize: number,
  config: WaiverScoringConfig = WAIVER_EYEQ_V1,
): number {
  assertPositiveInteger(slot, "slot");
  assertPositiveInteger(resultFieldSize, "resultFieldSize");
  return config.baseHitPoints + resultFieldSize + slotBonus(slot, config);
}

export function maxRawPointsForCalls(
  callsMade: number,
  resultFieldSize: number,
  config: WaiverScoringConfig = WAIVER_EYEQ_V1,
): number {
  let total = 0;
  for (let slot = 1; slot <= callsMade; slot += 1) {
    total += maxRawPointsForSlot(slot, resultFieldSize, config);
  }
  return total;
}

export function scoreWaiverCall(
  slot: number,
  actualWaiverRank: number | null,
  resultFieldSize: number,
  config: WaiverScoringConfig = WAIVER_EYEQ_V1,
): WaiverCallScore {
  assertPositiveInteger(slot, "slot");
  assertPositiveInteger(resultFieldSize, "resultFieldSize");
  if (slot > resultFieldSize) {
    throw new WaiverScoringError(`slot ${slot} exceeds result field size ${resultFieldSize}`);
  }
  if (actualWaiverRank !== null) assertPositiveInteger(actualWaiverRank, "actualWaiverRank");

  const inResultField = actualWaiverRank !== null && actualWaiverRank <= resultFieldSize;
  if (!inResultField) {
    return {
      slot,
      actualWaiverRank,
      inResultField: false,
      exactSlotHit: false,
      basePoints: 0,
      accuracyPoints: 0,
      slotBonusPoints: 0,
      totalPoints: 0,
    };
  }

  const exactSlotHit = actualWaiverRank === slot;
  const basePoints = config.baseHitPoints;
  const accuracyPoints = resultFieldSize - Math.abs(slot - actualWaiverRank);
  const slotBonusPoints = exactSlotHit ? slotBonus(slot, config) : 0;
  return {
    slot,
    actualWaiverRank,
    inResultField: true,
    exactSlotHit,
    basePoints,
    accuracyPoints,
    slotBonusPoints,
    totalPoints: basePoints + accuracyPoints + slotBonusPoints,
  };
}

/** Waiver EyeQ hundredths from integer inputs, rounded half-up. */
export function waiverEyeqHundredths(input: {
  earnedRawPoints: number;
  maxRawPoints: number;
  callsMade: number;
  availableSlots: number;
  config?: WaiverScoringConfig;
}): number | null {
  const config = input.config ?? WAIVER_EYEQ_V1;
  const { earnedRawPoints, maxRawPoints, callsMade, availableSlots } = input;
  if (callsMade === 0) return null;
  for (const [name, value] of Object.entries({ earnedRawPoints, maxRawPoints, callsMade, availableSlots })) {
    if (!Number.isInteger(value) || value < 0) {
      throw new WaiverScoringError(`${name} must be a non-negative integer (got ${value})`);
    }
  }
  if (callsMade > availableSlots) {
    throw new WaiverScoringError(`callsMade ${callsMade} exceeds available slots ${availableSlots}`);
  }
  if (maxRawPoints <= 0 || earnedRawPoints > maxRawPoints) {
    throw new WaiverScoringError(`earned ${earnedRawPoints} must be within 0..${maxRawPoints}`);
  }
  const modifierNumerator =
    config.coverageFloorPercent * availableSlots + config.coverageWeightPercent * callsMade;
  // hundredths = 100 · (earned / max) · (modifierNumerator / (100 · K)) · 100
  const numerator = earnedRawPoints * modifierNumerator * 100;
  const denominator = maxRawPoints * availableSlots;
  const hundredths = Math.floor((2 * numerator + denominator) / (2 * denominator));
  if (hundredths < 0 || hundredths > 10000) {
    throw new WaiverScoringError(`Waiver EyeQ out of range (${hundredths} hundredths)`);
  }
  return hundredths;
}

/**
 * Scores a contiguous board. `actualRanksBySlot[i]` is the shared Waiver Pool
 * Rank of the player called in slot i + 1 (null if unranked). Blank slots are
 * simply absent — callers pass only the calls actually made.
 */
export function scoreWaiverBoard(input: {
  actualRanksBySlot: ReadonlyArray<number | null>;
  resultFieldSize: number;
  availableSlots: number;
  config?: WaiverScoringConfig;
}): WaiverBoardScore {
  const config = input.config ?? WAIVER_EYEQ_V1;
  const { resultFieldSize, availableSlots } = input;
  assertPositiveInteger(resultFieldSize, "resultFieldSize");
  if (!Number.isInteger(availableSlots) || availableSlots < 0) {
    throw new WaiverScoringError(`availableSlots must be a non-negative integer (got ${availableSlots})`);
  }
  if (availableSlots > resultFieldSize) {
    throw new WaiverScoringError(
      `availableSlots ${availableSlots} exceeds result field size ${resultFieldSize}`,
    );
  }
  const callsMade = input.actualRanksBySlot.length;
  if (callsMade > availableSlots) {
    throw new WaiverScoringError(`callsMade ${callsMade} exceeds available slots ${availableSlots}`);
  }

  const calls = input.actualRanksBySlot.map((rank, index) =>
    scoreWaiverCall(index + 1, rank, resultFieldSize, config),
  );
  const earnedRawPoints = calls.reduce((sum, call) => sum + call.totalPoints, 0);
  const maxRawPoints = maxRawPointsForCalls(callsMade, resultFieldSize, config);

  return {
    scoringVersion: config.slug,
    callsMade,
    availableSlots,
    resultFieldSize,
    calls,
    earnedRawPoints,
    maxRawPoints,
    callQuality: callsMade === 0 ? null : { numerator: earnedRawPoints, denominator: maxRawPoints },
    eyeqHundredths: waiverEyeqHundredths({
      earnedRawPoints,
      maxRawPoints,
      callsMade,
      availableSlots,
      config,
    }),
    allCallsExact: callsMade === 0 ? null : calls.every((call) => call.exactSlotHit),
  };
}
