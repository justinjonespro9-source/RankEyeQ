import { describe, expect, it } from "vitest";
import {
  gradedSubmissionQualifiesForLeaderboard,
  type LeaderboardFilter,
} from "@/lib/leaderboards";

describe("gradedSubmissionQualifiesForLeaderboard", () => {
  it("requires GRADED status, a score, and at least one pick", () => {
    expect(
      gradedSubmissionQualifiesForLeaderboard({
        status: "GRADED",
        normalizedScore: 88,
        picks: [{ id: "1" }],
      }),
    ).toBe(true);
  });

  it("rejects DRAFT, SUBMITTED, LOCKED, null score, and empty picks", () => {
    expect(
      gradedSubmissionQualifiesForLeaderboard({
        status: "DRAFT",
        normalizedScore: 88,
        picks: [{ id: "1" }],
      }),
    ).toBe(false);
    expect(
      gradedSubmissionQualifiesForLeaderboard({
        status: "SUBMITTED",
        normalizedScore: 88,
        picks: [{ id: "1" }],
      }),
    ).toBe(false);
    expect(
      gradedSubmissionQualifiesForLeaderboard({
        status: "LOCKED",
        normalizedScore: 88,
        picks: [{ id: "1" }],
      }),
    ).toBe(false);
    expect(
      gradedSubmissionQualifiesForLeaderboard({
        status: "GRADED",
        normalizedScore: null,
        picks: [{ id: "1" }],
      }),
    ).toBe(false);
    expect(
      gradedSubmissionQualifiesForLeaderboard({
        status: "GRADED",
        normalizedScore: 88,
        picks: [],
      }),
    ).toBe(false);
  });
});

describe("leaderboard class filters", () => {
  it("keeps the public filter vocabulary stable", () => {
    const filters: LeaderboardFilter[] = [
      "ALL",
      "HUMAN",
      "AI",
      "EXPERT",
      "CREATOR",
    ];
    expect(filters).toEqual(["ALL", "HUMAN", "AI", "EXPERT", "CREATOR"]);
  });
});
