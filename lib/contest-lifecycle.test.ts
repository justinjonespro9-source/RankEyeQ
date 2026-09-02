import { describe, expect, it } from "vitest";
import {
  canTransitionContest,
  contestAllowsEdits,
  submissionAllowsEdits,
  submissionIsEligible,
} from "@/lib/contest-lifecycle";

describe("contest lifecycle rules", () => {
  it("allows edits only for DRAFT/OPEN contests", () => {
    expect(contestAllowsEdits("OPEN")).toBe(true);
    expect(contestAllowsEdits("DRAFT")).toBe(true);
    expect(contestAllowsEdits("LOCKED")).toBe(false);
    expect(contestAllowsEdits("FINAL")).toBe(false);
  });

  it("requires explicit SUBMITTED for eligibility", () => {
    expect(submissionIsEligible("DRAFT")).toBe(false);
    expect(submissionIsEligible("SUBMITTED")).toBe(true);
    expect(submissionIsEligible("LOCKED")).toBe(true);
    expect(submissionIsEligible("GRADED")).toBe(true);
  });

  it("blocks edits when contest is locked even if submission is SUBMITTED", () => {
    expect(submissionAllowsEdits("OPEN", "SUBMITTED")).toBe(true);
    expect(submissionAllowsEdits("LOCKED", "SUBMITTED")).toBe(false);
    expect(submissionAllowsEdits("OPEN", "LOCKED")).toBe(false);
    expect(submissionAllowsEdits("OPEN", "GRADED")).toBe(false);
  });

  it("validates practical contest transitions", () => {
    expect(canTransitionContest("OPEN", "LOCKED")).toBe(true);
    expect(canTransitionContest("LOCKED", "GRADING")).toBe(true);
    expect(canTransitionContest("FINAL", "GRADING")).toBe(true);
    expect(canTransitionContest("ARCHIVED", "OPEN")).toBe(false);
  });
});
