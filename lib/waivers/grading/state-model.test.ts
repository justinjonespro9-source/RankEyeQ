import { describe, expect, it } from "vitest";
import { waiverGradeRunNextAction, waiverGradeRunStage } from "@/lib/waivers/grading/state-model";

const facts = { approved: false, everApplied: false, isCurrentAuthority: false, currentPublished: false };

describe("waiverGradeRunStage", () => {
  it("walks stored → approved → applied → published, one operator step at a time", () => {
    expect(waiverGradeRunStage(facts)).toBe("STORED");
    expect(waiverGradeRunStage({ ...facts, approved: true })).toBe("APPROVED");
    expect(waiverGradeRunStage({ ...facts, approved: true, everApplied: true, isCurrentAuthority: true })).toBe("APPLIED");
    expect(waiverGradeRunStage({ ...facts, approved: true, everApplied: true, isCurrentAuthority: true, currentPublished: true })).toBe("PUBLISHED");
  });

  it("a run replaced by a later authority change is superseded, and a published flag never applies to a non-current run", () => {
    expect(waiverGradeRunStage({ ...facts, approved: true, everApplied: true })).toBe("SUPERSEDED");
    expect(waiverGradeRunStage({ ...facts, approved: true, everApplied: true, currentPublished: true })).toBe("SUPERSEDED");
  });

  it("offers exactly the next stage's action (apply never implies publish)", () => {
    expect(waiverGradeRunNextAction("STORED")).toBe("APPROVE");
    expect(waiverGradeRunNextAction("APPROVED")).toBe("APPLY");
    expect(waiverGradeRunNextAction("APPLIED")).toBe("PUBLISH");
    expect(waiverGradeRunNextAction("PUBLISHED")).toBeNull();
    expect(waiverGradeRunNextAction("SUPERSEDED")).toBeNull();
  });
});
