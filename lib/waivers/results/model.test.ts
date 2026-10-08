import { describe, expect, it } from "vitest";
import {
  deriveWaiverGradeRunLifecycle,
  deriveWaiverUngradableReason,
  WAIVER_GRADE_APPROVAL_POLICIES,
  WAIVER_GRADING_APPROVAL_ATTESTATION_VERSION,
  WAIVER_GRADING_APPROVAL_POLICY,
  WAIVER_GRADING_RULESET_VERSION,
  WAIVER_HONOR_INELIGIBLE_REASONS,
  WAIVER_RESULTS_POLICY_VERSION,
  WAIVER_UNGRADABLE_REASONS,
} from "@/lib/waivers/results/model";

const base = { gradeRunId: "run-1", approved: false, currentGradeRunId: null, everAuthoritative: false, artifactState: "ACCEPTED" as const };

describe("results and grading vocabulary", () => {
  it("pins the versions that the database CHECK constraints also pin", () => {
    expect(WAIVER_RESULTS_POLICY_VERSION).toBe("rankeyeq-waiver-results/1");
    expect(WAIVER_GRADING_RULESET_VERSION).toBe("rankeyeq-waiver-grading/1");
    expect(WAIVER_GRADING_APPROVAL_ATTESTATION_VERSION).toMatch(/^rankeyeq-waiver-grading-approval\//);
  });

  it("V1 approval is explicit single-admin; separate approval is supported", () => {
    expect(WAIVER_GRADING_APPROVAL_POLICY).toBe("SINGLE_ADMIN_EXPLICIT");
    expect(WAIVER_GRADE_APPROVAL_POLICIES).toEqual(["SINGLE_ADMIN_EXPLICIT", "SEPARATE_APPROVER"]);
  });

  it("N/A boards carry a reason for honor ineligibility", () => {
    expect(WAIVER_HONOR_INELIGIBLE_REASONS).toEqual({
      NA_ZERO_CALL: "ZERO_CALL_BOARD",
      NA_ALL_NEUTRALIZED: "ALL_CALLS_NEUTRALIZED",
      NA_NO_EFFECTIVE_SLOTS: "NO_EFFECTIVE_SLOTS",
    });
  });

  it("an ungradable board's reason distinguishes an emptied pool from neutralizations consuming the slots", () => {
    expect(WAIVER_UNGRADABLE_REASONS).toEqual(["CORRECTED_POOL_EMPTY", "NEUTRALIZATIONS_CONSUMED_SLOTS"]);
    expect(deriveWaiverUngradableReason(0)).toBe("CORRECTED_POOL_EMPTY");
    expect(deriveWaiverUngradableReason(2)).toBe("NEUTRALIZATIONS_CONSUMED_SLOTS");
  });
});

describe("deriveWaiverGradeRunLifecycle", () => {
  it("a stored run is PROPOSED until approved, and APPROVED_NOT_APPLIED until an authority change applies it", () => {
    expect(deriveWaiverGradeRunLifecycle(base)).toBe("PROPOSED");
    expect(deriveWaiverGradeRunLifecycle({ ...base, approved: true })).toBe("APPROVED_NOT_APPLIED");
    expect(deriveWaiverGradeRunLifecycle({ ...base, approved: true, currentGradeRunId: "run-0", everAuthoritative: false })).toBe("APPROVED_NOT_APPLIED");
  });

  it("the week pointer's run is CURRENT, labeled when its source was later superseded or withdrawn", () => {
    const current = { ...base, approved: true, currentGradeRunId: "run-1", everAuthoritative: true };
    expect(deriveWaiverGradeRunLifecycle(current)).toBe("CURRENT");
    expect(deriveWaiverGradeRunLifecycle({ ...current, artifactState: "SUPERSEDED" })).toBe("CURRENT_SOURCE_SUPERSEDED");
    expect(deriveWaiverGradeRunLifecycle({ ...current, artifactState: "WITHDRAWN" })).toBe("CURRENT_SOURCE_WITHDRAWN");
  });

  it("a once-authoritative run replaced by a regrade is SUPERSEDED", () => {
    expect(deriveWaiverGradeRunLifecycle({ ...base, approved: true, currentGradeRunId: "run-2", everAuthoritative: true })).toBe("SUPERSEDED");
  });
});
