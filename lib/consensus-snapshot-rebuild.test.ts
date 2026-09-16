import { describe, expect, it } from "vitest";
import {
  evaluateReconstructionEligibility,
  isStalePregameSnapshot,
} from "@/lib/consensus-snapshot-rebuild";

const LOCK = new Date("2026-09-13T15:00:00.000Z");

function tenPicks(committedAt: Date | null) {
  return Array.from({ length: 10 }, (_, i) => ({
    predictedRank: i + 1,
    rankableEntryId: `e${i}`,
    committedAt,
    lockedAt: LOCK as Date | null, // set by canonical lock — allowed
  }));
}

describe("evaluateReconstructionEligibility", () => {
  it("qualifies boards whose only post-lock write is submission.updatedAt pattern", () => {
    const result = evaluateReconstructionEligibility(
      {
        status: "LOCKED",
        submittedAt: new Date("2026-09-07T12:00:00.000Z"),
        rankingDepth: 10,
        picks: tenPicks(new Date("2026-09-07T12:05:00.000Z")),
        publicConsensusEligible: true,
        statusEligible: true,
      },
      LOCK,
    );
    expect(result.qualifies).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("rejects scoring picks committed after lock", () => {
    const picks = tenPicks(new Date("2026-09-07T12:00:00.000Z"));
    picks[3]!.committedAt = new Date("2026-09-13T16:00:00.000Z");
    const result = evaluateReconstructionEligibility(
      {
        status: "LOCKED",
        submittedAt: new Date("2026-09-07T12:00:00.000Z"),
        rankingDepth: 10,
        picks,
        publicConsensusEligible: true,
        statusEligible: true,
      },
      LOCK,
    );
    expect(result.qualifies).toBe(false);
    expect(result.pickIssues.some((i) => i.issue.includes("committedAt after"))).toBe(
      true,
    );
  });

  it("rejects missing committedAt on scoring picks", () => {
    const picks = tenPicks(new Date("2026-09-07T12:00:00.000Z"));
    picks[0] = {
      ...picks[0]!,
      committedAt: null,
    };
    const result = evaluateReconstructionEligibility(
      {
        status: "LOCKED",
        submittedAt: new Date("2026-09-07T12:00:00.000Z"),
        rankingDepth: 10,
        picks,
        publicConsensusEligible: true,
        statusEligible: true,
      },
      LOCK,
    );
    expect(result.qualifies).toBe(false);
  });

  it("allows pick lockedAt exactly at canonical lock", () => {
    const picks = tenPicks(new Date("2026-09-07T12:00:00.000Z")).map((p) => ({
      ...p,
      lockedAt: LOCK,
    }));
    const result = evaluateReconstructionEligibility(
      {
        status: "LOCKED",
        submittedAt: new Date("2026-09-07T12:00:00.000Z"),
        rankingDepth: 10,
        picks,
        publicConsensusEligible: true,
        statusEligible: true,
      },
      LOCK,
    );
    expect(result.qualifies).toBe(true);
  });

  it("excludes private / non-visible boards", () => {
    const result = evaluateReconstructionEligibility(
      {
        status: "LOCKED",
        submittedAt: new Date("2026-09-07T12:00:00.000Z"),
        rankingDepth: 10,
        picks: tenPicks(new Date("2026-09-07T12:00:00.000Z")),
        publicConsensusEligible: false,
        statusEligible: true,
      },
      LOCK,
    );
    expect(result.qualifies).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/visibility/);
  });
});

describe("isStalePregameSnapshot", () => {
  it("detects Sept 6 snapshot vs Sept 13 week lock", () => {
    expect(
      isStalePregameSnapshot({
        snapshotLockedAt: new Date("2026-09-06T15:00:00.000Z"),
        weekFullLockAt: new Date("2026-09-13T15:00:00.000Z"),
      }),
    ).toBe(true);
    expect(
      isStalePregameSnapshot({
        snapshotLockedAt: new Date("2026-09-13T15:00:00.000Z"),
        weekFullLockAt: new Date("2026-09-13T15:00:00.000Z"),
      }),
    ).toBe(false);
  });
});
