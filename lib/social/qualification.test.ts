import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUALIFICATION_RULES,
  evaluateCreatorQualification,
} from "@/lib/social/qualification";

describe("creator qualification", () => {
  it("is not eligible below the minimum graded contest sample", () => {
    const result = evaluateCreatorQualification({
      profileType: "HUMAN",
      status: "ACTIVE",
      gradedContestCount: 9,
      creatorEnabled: false,
    });
    expect(result.eligible).toBe(false);
    expect(result.status).toBe("NOT_ELIGIBLE");
    expect(result.reasons[0]).toMatch(/10 graded contests/);
  });

  it("becomes ELIGIBLE after the minimum graded contests", () => {
    const result = evaluateCreatorQualification({
      profileType: "HUMAN",
      status: "ACTIVE",
      gradedContestCount: 10,
      creatorEnabled: false,
    });
    expect(result.eligible).toBe(true);
    expect(result.status).toBe("ELIGIBLE");
    expect(result.reasons).toEqual([]);
  });

  it("is ENABLED when eligible and opted in", () => {
    const result = evaluateCreatorQualification({
      profileType: "HUMAN",
      status: "ACTIVE",
      gradedContestCount: 12,
      creatorEnabled: true,
    });
    expect(result.status).toBe("ENABLED");
  });

  it("does not let AI profiles become payout creators", () => {
    const result = evaluateCreatorQualification({
      profileType: "AI",
      status: "ACTIVE",
      gradedContestCount: 20,
      creatorEnabled: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.status).toBe("NOT_ELIGIBLE");
    expect(result.reasons[0]).toMatch(/human profiles/i);
  });

  it("does not let benchmark sources become payout creators", () => {
    const result = evaluateCreatorQualification({
      profileType: "BENCHMARK",
      status: "ACTIVE",
      gradedContestCount: 20,
      creatorEnabled: true,
    });
    expect(result.eligible).toBe(false);
  });

  it("blocks suspended profiles even with sample size", () => {
    const result = evaluateCreatorQualification({
      profileType: "HUMAN",
      status: "SUSPENDED",
      gradedContestCount: 20,
      creatorEnabled: false,
    });
    expect(result.eligible).toBe(false);
  });

  it("keeps percentile thresholds disabled by default", () => {
    expect(DEFAULT_QUALIFICATION_RULES.minSeasonPercentile).toBeNull();
    expect(DEFAULT_QUALIFICATION_RULES.minPositionPercentile).toBeNull();
    const result = evaluateCreatorQualification(
      {
        profileType: "HUMAN",
        status: "ACTIVE",
        gradedContestCount: 10,
        creatorEnabled: false,
        seasonPercentile: 99,
      },
      DEFAULT_QUALIFICATION_RULES,
    );
    expect(result.eligible).toBe(true);
  });
});
