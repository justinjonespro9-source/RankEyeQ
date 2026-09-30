import { WaiverPrecisionError, divideRoundHalfAwayFromZero } from "@/lib/waivers/precision";

/**
 * Fantasy production for one board, separate from Waiver EyeQ.
 * Each entry of `calls` is a real submitted call (a 0-FP call is still a call);
 * blank slots are absent. Values are integer hundredths.
 */
export type WaiverProduction = {
  callsMade: number;
  availableSlots: number;
  totalFpHundredths: number;
  /** N/A (null) when no calls were made. */
  fpPerCallHundredths: number | null;
  /** 0.0 for an explicit zero-call board; null only when no slots exist. */
  fpPerAvailableSlotHundredths: number | null;
  /** Descriptive coverage (calls / available slots); null when no slots exist. */
  coverage: { numerator: number; denominator: number } | null;
};

export function computeWaiverProduction(input: {
  calls: ReadonlyArray<{ fpHundredths: number }>;
  availableSlots: number;
}): WaiverProduction {
  const { calls, availableSlots } = input;
  if (!Number.isInteger(availableSlots) || availableSlots < 0) {
    throw new WaiverPrecisionError(`availableSlots must be a non-negative integer (got ${availableSlots})`);
  }
  if (calls.length > availableSlots) {
    throw new WaiverPrecisionError(`callsMade ${calls.length} exceeds available slots ${availableSlots}`);
  }
  for (const call of calls) {
    if (!Number.isInteger(call.fpHundredths)) {
      throw new WaiverPrecisionError("Call fantasy points must be integer hundredths");
    }
  }

  const callsMade = calls.length;
  const totalFpHundredths = calls.reduce((sum, call) => sum + call.fpHundredths, 0);
  return {
    callsMade,
    availableSlots,
    totalFpHundredths,
    fpPerCallHundredths:
      callsMade === 0 ? null : divideRoundHalfAwayFromZero(totalFpHundredths, callsMade),
    fpPerAvailableSlotHundredths:
      availableSlots === 0 ? null : divideRoundHalfAwayFromZero(totalFpHundredths, availableSlots),
    coverage: availableSlots === 0 ? null : { numerator: callsMade, denominator: availableSlots },
  };
}
