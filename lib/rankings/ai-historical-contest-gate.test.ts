import { describe, expect, it } from "vitest";
import {
  contestAllowsAiHistoricalEntry,
  evaluateAiHistoricalContestGate,
} from "@/lib/rankings/ai-historical-contest-gate";

describe("evaluateAiHistoricalContestGate", () => {
  it("allows OPEN and LOCKED while week is still open", () => {
    expect(
      evaluateAiHistoricalContestGate({
        contestStatus: "OPEN",
        weekStatus: "OPEN",
      }),
    ).toEqual({ allowed: true, outcome: null, reason: null });
    expect(
      evaluateAiHistoricalContestGate({
        contestStatus: "LOCKED",
        weekStatus: "OPEN",
      }),
    ).toEqual({ allowed: true, outcome: null, reason: null });
    expect(contestAllowsAiHistoricalEntry("LOCKED", "OPEN")).toBe(true);
  });

  it("HOLDs LIVE/GRADING/FINAL contests without a separate policy", () => {
    for (const contestStatus of ["LIVE", "GRADING", "FINAL"] as const) {
      const result = evaluateAiHistoricalContestGate({
        contestStatus,
        weekStatus: "OPEN",
      });
      expect(result.allowed).toBe(false);
      expect(result.outcome).toBe("HOLD");
      expect(result.reason).toMatch(/HOLDs/i);
    }
  });

  it("HOLDs when week is COMPLETE even if contest is LOCKED", () => {
    const result = evaluateAiHistoricalContestGate({
      contestStatus: "LOCKED",
      weekStatus: "COMPLETE",
    });
    expect(result.allowed).toBe(false);
    expect(result.outcome).toBe("HOLD");
    expect(result.reason).toMatch(/Week is COMPLETE/i);
  });

  it("blocks DRAFT and ARCHIVED contests", () => {
    expect(
      evaluateAiHistoricalContestGate({
        contestStatus: "DRAFT",
        weekStatus: "OPEN",
      }).outcome,
    ).toBe("BLOCKED");
    expect(
      evaluateAiHistoricalContestGate({
        contestStatus: "ARCHIVED",
        weekStatus: "OPEN",
      }).outcome,
    ).toBe("BLOCKED");
    expect(contestAllowsAiHistoricalEntry("ARCHIVED", "OPEN")).toBe(false);
  });
});
