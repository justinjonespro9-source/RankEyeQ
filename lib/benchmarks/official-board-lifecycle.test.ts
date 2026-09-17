import { describe, expect, it } from "vitest";
import { shouldAutoGradeOfficialBenchmarkSubmission } from "@/lib/benchmarks/snapshots";

/**
 * Documents official benchmark RankingSubmission lifecycle after capture.
 *
 * LOCKED = competitive board committed; not yet scored by week grading.
 * GRADED = scores written (via gradeContest, or auto-grade on historical
 *          backfill / re-capture of an already-graded board).
 */
describe("official benchmark submission auto-grade lifecycle", () => {
  it("normal Sunday/Thursday capture stays LOCKED even if ContestEntry actuals exist", () => {
    expect(
      shouldAutoGradeOfficialBenchmarkSubmission({
        historicalBackfill: false,
        existingStatus: null,
      }),
    ).toBe(false);
    expect(
      shouldAutoGradeOfficialBenchmarkSubmission({
        historicalBackfill: false,
        existingStatus: "LOCKED",
      }),
    ).toBe(false);
    expect(
      shouldAutoGradeOfficialBenchmarkSubmission({
        historicalBackfill: false,
        existingStatus: "SUBMITTED",
      }),
    ).toBe(false);
  });

  it("historical backfill auto-grades when actuals exist (caller still checks actuals)", () => {
    expect(
      shouldAutoGradeOfficialBenchmarkSubmission({
        historicalBackfill: true,
        existingStatus: null,
      }),
    ).toBe(true);
    expect(
      shouldAutoGradeOfficialBenchmarkSubmission({
        historicalBackfill: true,
        existingStatus: "LOCKED",
      }),
    ).toBe(true);
  });

  it("re-capture of an already-GRADED board refreshes scores", () => {
    expect(
      shouldAutoGradeOfficialBenchmarkSubmission({
        historicalBackfill: false,
        existingStatus: "GRADED",
      }),
    ).toBe(true);
  });

  it("preserves GRADED status decision independently of draft/locked", () => {
    expect(
      shouldAutoGradeOfficialBenchmarkSubmission({
        historicalBackfill: false,
        existingStatus: "DRAFT",
      }),
    ).toBe(false);
  });
});
