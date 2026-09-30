import { describe, expect, it } from "vitest";
import { WAIVER_WEEKLY_MAX_CALLS } from "@/lib/waivers/constants";
import { WaiverPrecisionError } from "@/lib/waivers/precision";
import { computeWaiverProduction } from "@/lib/waivers/production";

describe("Waiver fantasy production metrics", () => {
  it("only Gordon selected (18 FP): FP/Call 18.0, FP/Available Slot 6.0", () => {
    expect(computeWaiverProduction({ calls: [{ fpHundredths: 1800 }], availableSlots: 3 })).toEqual({
      callsMade: 1,
      availableSlots: 3,
      totalFpHundredths: 1800,
      fpPerCallHundredths: 1800,
      fpPerAvailableSlotHundredths: 600,
      coverage: { numerator: 1, denominator: 3 },
    });
  });

  it("full board 18 + 12 + 9: FP/Call 13.0, FP/Available Slot 13.0", () => {
    const result = computeWaiverProduction({
      calls: [{ fpHundredths: 1800 }, { fpHundredths: 1200 }, { fpHundredths: 900 }],
      availableSlots: 3,
    });
    expect(result).toMatchObject({ totalFpHundredths: 3900, fpPerCallHundredths: 1300, fpPerAvailableSlotHundredths: 1300 });
  });

  it("explicit zero-call board: FP/Call N/A, FP/Available Slot 0.0", () => {
    expect(computeWaiverProduction({ calls: [], availableSlots: 3 })).toEqual({
      callsMade: 0,
      availableSlots: 3,
      totalFpHundredths: 0,
      fpPerCallHundredths: null,
      fpPerAvailableSlotHundredths: 0,
      coverage: { numerator: 0, denominator: 3 },
    });
  });

  it("keeps a blank slot and a selected 0-FP player as different facts", () => {
    const blank = computeWaiverProduction({ calls: [], availableSlots: 3 });
    const zeroCall = computeWaiverProduction({ calls: [{ fpHundredths: 0 }], availableSlots: 3 });
    expect(blank.fpPerAvailableSlotHundredths).toBe(0);
    expect(zeroCall.fpPerAvailableSlotHundredths).toBe(0);
    expect(blank.callsMade).toBe(0);
    expect(zeroCall.callsMade).toBe(1);
    expect(blank.fpPerCallHundredths).toBeNull();
    expect(zeroCall.fpPerCallHundredths).toBe(0);
    expect(zeroCall.coverage).toEqual({ numerator: 1, denominator: 3 });
  });

  it("rounds half away from zero deterministically, including negative points", () => {
    expect(computeWaiverProduction({ calls: [{ fpHundredths: 100 }, { fpHundredths: 101 }], availableSlots: 3 }).fpPerCallHundredths).toBe(101);
    expect(computeWaiverProduction({ calls: [{ fpHundredths: -100 }, { fpHundredths: -101 }], availableSlots: 3 }).fpPerCallHundredths).toBe(-101);
    expect(computeWaiverProduction({ calls: [{ fpHundredths: 100 }], availableSlots: 3 }).fpPerAvailableSlotHundredths).toBe(33);
    expect(computeWaiverProduction({ calls: [{ fpHundredths: -250 }], availableSlots: 1 }).fpPerCallHundredths).toBe(-250);
  });

  it("uses effective depth for small pools", () => {
    expect(computeWaiverProduction({ calls: [{ fpHundredths: 1000 }, { fpHundredths: 600 }], availableSlots: 2 })).toMatchObject({
      fpPerAvailableSlotHundredths: 800,
      coverage: { numerator: 2, denominator: 2 },
    });
    expect(computeWaiverProduction({ calls: [], availableSlots: 0 })).toMatchObject({ fpPerAvailableSlotHundredths: null, coverage: null });
  });

  it("rejects raw floats and over-deep boards", () => {
    expect(() => computeWaiverProduction({ calls: [{ fpHundredths: 18.4 }], availableSlots: 3 })).toThrow(WaiverPrecisionError);
    expect(() => computeWaiverProduction({ calls: [{ fpHundredths: 1 }, { fpHundredths: 1 }], availableSlots: 1 })).toThrow(WaiverPrecisionError);
  });

  it("weekly descriptive maximum is 17 calls (3 + 3 + 5 + 3 + 3)", () => {
    expect(WAIVER_WEEKLY_MAX_CALLS).toBe(17);
  });
});
