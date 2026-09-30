import { WAIVER_OWNERSHIP_THRESHOLD_BPS } from "@/lib/waivers/constants";

/**
 * Canonical Waivers precision: fantasy points compare as integer hundredths.
 * Half-PPR V2 values are multiples of 0.02, so hundredths are lossless; a value
 * that is not (e.g. a future finer-grained ruleset) fails loudly instead of
 * silently rounding into a false tie.
 */
export const FP_HUNDREDTHS_DRIFT_TOLERANCE = 1e-6;

export class WaiverPrecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WaiverPrecisionError";
  }
}

export function toFpHundredths(fantasyPoints: number): number {
  if (!Number.isFinite(fantasyPoints)) {
    throw new WaiverPrecisionError(`Fantasy points must be finite (got ${fantasyPoints})`);
  }
  const scaled = fantasyPoints * 100;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > FP_HUNDREDTHS_DRIFT_TOLERANCE) {
    throw new WaiverPrecisionError(
      `Fantasy points ${fantasyPoints} are not representable in hundredths`,
    );
  }
  return rounded === 0 ? 0 : rounded;
}

/** Integer division rounded half away from zero (deterministic for negatives). */
export function divideRoundHalfAwayFromZero(numerator: number, denominator: number): number {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) {
    throw new WaiverPrecisionError("Rounded division requires integers");
  }
  if (denominator <= 0) {
    throw new WaiverPrecisionError("Rounded division requires a positive denominator");
  }
  const sign = numerator < 0 ? -1 : 1;
  const magnitude = Math.floor((2 * Math.abs(numerator) + denominator) / (2 * denominator));
  return magnitude === 0 ? 0 : sign * magnitude;
}

export type RosteredPercentParse =
  | { ok: true; bps: number }
  | { ok: false; reason: "EMPTY" | "UNPARSEABLE" | "TOO_MANY_DECIMALS" | "OUT_OF_RANGE" };

const PERCENT_PATTERN = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

/**
 * Parses a roster percentage ("49", "49.5", "49.50%") into basis points.
 * Ambiguous forms (comma decimals, more than two decimals, fractions) are rejected.
 */
export function parseRosteredPercentToBps(input: string): RosteredPercentParse {
  const trimmed = input.trim().replace(/\s*%$/, "");
  if (trimmed === "") return { ok: false, reason: "EMPTY" };
  if (/^\d+\.\d{3,}$/.test(trimmed)) return { ok: false, reason: "TOO_MANY_DECIMALS" };
  const match = PERCENT_PATTERN.exec(trimmed);
  if (!match) return { ok: false, reason: "UNPARSEABLE" };
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const bps = whole * 100 + fraction;
  if (bps > 10000) return { ok: false, reason: "OUT_OF_RANGE" };
  return { ok: true, bps };
}

export function isBelowOwnershipThreshold(
  rosteredBps: number,
  thresholdBps: number = WAIVER_OWNERSHIP_THRESHOLD_BPS,
): boolean {
  if (!Number.isInteger(rosteredBps) || !Number.isInteger(thresholdBps)) {
    throw new WaiverPrecisionError("Ownership comparisons require integer basis points");
  }
  return rosteredBps < thresholdBps;
}
