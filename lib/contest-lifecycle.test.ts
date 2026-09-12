import { describe, expect, it } from "vitest";
import {
  canTransitionContest,
  contestAllowsEdits,
  contestAllowsRankingEdits,
  submissionAllowsEdits,
  submissionAllowsRankingEdits,
  submissionIsEligible,
} from "@/lib/contest-lifecycle";

describe("contest lifecycle rules", () => {
  it("allows edits only for DRAFT/OPEN contests (status-only helper)", () => {
    expect(contestAllowsEdits("OPEN")).toBe(true);
    expect(contestAllowsEdits("DRAFT")).toBe(true);
    expect(contestAllowsEdits("LOCKED")).toBe(false);
    expect(contestAllowsEdits("FINAL")).toBe(false);
  });

  it("treats premature LOCKED as editable until Week.fullLockAt", () => {
    const fullLockAt = new Date("2026-09-13T15:00:00.000Z");
    const now = new Date("2026-09-12T14:00:00.000Z");
    expect(
      contestAllowsRankingEdits({
        contestStatus: "LOCKED",
        fullBoardLocked: false,
        fullLockAt,
        now,
      }),
    ).toBe(true);
    expect(
      contestAllowsRankingEdits({
        contestStatus: "LOCKED",
        fullBoardLocked: true,
        fullLockAt,
        now: fullLockAt,
      }),
    ).toBe(false);
    // Admin lock without week fullLockAt still blocks.
    expect(
      contestAllowsRankingEdits({
        contestStatus: "LOCKED",
        fullBoardLocked: false,
        fullLockAt: null,
        now,
      }),
    ).toBe(false);
  });

  it("requires explicit SUBMITTED for eligibility", () => {
    expect(submissionIsEligible("DRAFT")).toBe(false);
    expect(submissionIsEligible("SUBMITTED")).toBe(true);
    expect(submissionIsEligible("LOCKED")).toBe(true);
    expect(submissionIsEligible("GRADED")).toBe(true);
  });

  it("blocks edits when contest is locked even if submission is SUBMITTED (legacy helper)", () => {
    expect(submissionAllowsEdits("OPEN", "SUBMITTED")).toBe(true);
    expect(submissionAllowsEdits("LOCKED", "SUBMITTED")).toBe(false);
    expect(submissionAllowsEdits("OPEN", "LOCKED")).toBe(false);
    expect(submissionAllowsEdits("OPEN", "GRADED")).toBe(false);
  });

  it("hybrid ranking edits keep SUBMITTED boards editable before full lock", () => {
    const fullLockAt = new Date("2026-09-13T15:00:00.000Z");
    const now = new Date("2026-09-12T14:00:00.000Z");
    expect(
      submissionAllowsRankingEdits({
        contestStatus: "OPEN",
        submissionStatus: "SUBMITTED",
        fullBoardLocked: false,
        fullLockAt,
        now,
      }),
    ).toBe(true);
    expect(
      submissionAllowsRankingEdits({
        contestStatus: "LOCKED",
        submissionStatus: "SUBMITTED",
        fullBoardLocked: false,
        fullLockAt,
        now,
      }),
    ).toBe(true);
  });

  it("validates practical contest transitions", () => {
    expect(canTransitionContest("OPEN", "LOCKED")).toBe(true);
    expect(canTransitionContest("LOCKED", "GRADING")).toBe(true);
    expect(canTransitionContest("FINAL", "GRADING")).toBe(true);
    expect(canTransitionContest("ARCHIVED", "OPEN")).toBe(false);
  });
});
