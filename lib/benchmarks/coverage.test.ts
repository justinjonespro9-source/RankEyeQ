import { describe, expect, it } from "vitest";
import { summarizeBenchmarkCoverage } from "@/lib/benchmarks/coverage";
import { benchmarkAffiliationDisclaimer } from "@/lib/benchmark-sources";

describe("benchmark coverage matrix", () => {
  it("counts expected/captured/locked/graded and missing positions, ignoring NOT_AVAILABLE", () => {
    const summary = summarizeBenchmarkCoverage({
      sources: [
        { id: "espn", username: "espn-fantasy", displayName: "ESPN Fantasy" },
        { id: "pff", username: "pff", displayName: "PFF" },
      ],
      positions: ["QB", "RB", "WR", "TE", "DEF"],
      cells: [
        {
          universalProfileId: "espn",
          position: "QB",
          snapshotStatus: "LOCKED",
          captureType: "SUNDAY",
          submissionStatus: "LOCKED",
          late: false,
        },
        {
          universalProfileId: "espn",
          position: "RB",
          snapshotStatus: "CAPTURED",
          captureType: "THURSDAY",
          submissionStatus: null,
          late: false,
        },
        {
          universalProfileId: "espn",
          position: "WR",
          snapshotStatus: "NOT_AVAILABLE",
          captureType: "MANUAL_FINAL",
          submissionStatus: null,
          late: false,
        },
        {
          universalProfileId: "espn",
          position: "TE",
          snapshotStatus: "GRADED",
          captureType: "SUNDAY",
          submissionStatus: "GRADED",
          late: false,
        },
        {
          universalProfileId: "pff",
          position: "QB",
          snapshotStatus: "CAPTURED",
          captureType: "SUNDAY",
          submissionStatus: null,
          late: true,
        },
      ],
    });

    expect(summary.rows[0].cells.WR).toBe("Not Available");
    expect(summary.rows[0].cells.RB).toBe("Thursday Snapshot");
    expect(summary.rows[0].cells.QB).toBe("Locked");
    expect(summary.expectedBoards).toBe(9);
    expect(summary.capturedBoards).toBe(4);
    expect(summary.fullyLockedBoards).toBe(2);
    expect(summary.gradedBoards).toBe(1);
    expect(summary.sourcesMissingPositions.map((row) => row.username).sort()).toEqual(
      ["espn-fantasy", "pff"],
    );
  });
});

describe("benchmark affiliation disclaimer", () => {
  it("states independent capture and names the source without implying affiliation", () => {
    const text = benchmarkAffiliationDisclaimer("FantasyPros ECR");
    expect(text).toMatch(/Independent RankEYEQ Expert Benchmark/);
    expect(text).toMatch(/not operated by or affiliated with FantasyPros ECR/);
    expect(text).not.toMatch(/official partner/i);
  });
});
