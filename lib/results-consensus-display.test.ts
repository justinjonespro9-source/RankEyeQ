import { describe, expect, it } from "vitest";
import {
  consensusDelta,
  consensusDeltaToneClass,
  describeConsensusDelta,
  formatConsensusDelta,
  nextResultsSort,
  sortResultsTableRows,
  type ResultsTableRow,
} from "@/lib/results-consensus-display";
import { provisionalStandingRowClass } from "@/lib/live-provisional";

describe("consensus delta sign convention", () => {
  it("keeps underlying actual − consensus math", () => {
    expect(consensusDelta(4, 1)).toBe(3);
    expect(consensusDelta(1, 10)).toBe(-9);
  });

  it("describes movement without raw +/− signs", () => {
    const better = describeConsensusDelta(-9);
    expect(better.direction).toBe("better");
    expect(better.spots).toBe(9);
    expect(better.visibleValue).toBe("9");
    expect(better.title).toBe("Finished 9 spots better than consensus");
    expect(better.toneClass).toContain("success");

    const worse = describeConsensusDelta(3);
    expect(worse.direction).toBe("worse");
    expect(worse.spots).toBe(3);
    expect(worse.visibleValue).toBe("3");
    expect(worse.title).toBe("Finished 3 spots worse than consensus");
    expect(worse.toneClass).toContain("danger");

    const even = describeConsensusDelta(0);
    expect(even.direction).toBe("even");
    expect(even.visibleValue).toBe("EVEN");
    expect(even.title).toBe("Finished even with consensus");
  });

  it("styles overperformance as success and underperformance as danger", () => {
    expect(consensusDeltaToneClass(-9)).toContain("success");
    expect(consensusDeltaToneClass(3)).toContain("danger");
    expect(consensusDeltaToneClass(0)).toContain("muted");
  });

  it("legacy formatConsensusDelta uses directional prefixes without +", () => {
    expect(formatConsensusDelta(3)).toBe("↓ 3");
    expect(formatConsensusDelta(-9)).toBe("↑ 9");
    expect(formatConsensusDelta(0)).toBe("EVEN");
  });
});

describe("results table sort", () => {
  const rows: ResultsTableRow[] = [
    {
      rankableEntryId: "a",
      name: "Zed",
      team: "ZZ",
      opponent: "AA",
      actualRank: 2,
      fantasyPoints: 20,
      selectionRate: 0.5,
      averageSelectedRank: 3,
      consensusRank: 1,
      consensusVsActual: 1,
      ballots: 10,
    },
    {
      rankableEntryId: "b",
      name: "Amy",
      team: "AA",
      opponent: "BB",
      actualRank: 1,
      fantasyPoints: 30,
      selectionRate: 0.8,
      averageSelectedRank: 2,
      consensusRank: 5,
      consensusVsActual: -4,
      ballots: 20,
    },
  ];

  it("defaults to actual ascending", () => {
    const sorted = sortResultsTableRows(rows, "actual", "asc");
    expect(sorted.map((r) => r.name)).toEqual(["Amy", "Zed"]);
  });

  it("sorts by underlying numeric delta (better-than-consensus first when asc)", () => {
    const sorted = sortResultsTableRows(rows, "delta", "asc");
    expect(sorted[0]?.consensusVsActual).toBe(-4);
    expect(sorted[1]?.consensusVsActual).toBe(1);
  });

  it("toggles sort direction on same key", () => {
    expect(nextResultsSort("actual", "asc", "actual")).toEqual({
      key: "actual",
      dir: "desc",
    });
    expect(nextResultsSort("actual", "asc", "pts")).toEqual({
      key: "pts",
      dir: "desc",
    });
  });
});

describe("podium row treatment", () => {
  it("uses distinct gold/silver/bronze accents vs green in-field", () => {
    expect(provisionalStandingRowClass("GOLD")).toMatch(/amber/);
    expect(provisionalStandingRowClass("SILVER")).toMatch(/slate/);
    expect(provisionalStandingRowClass("BRONZE")).toMatch(/orange/);
    expect(provisionalStandingRowClass("IN_FIELD")).toMatch(/emerald/);
    expect(provisionalStandingRowClass("OUTSIDE_FIELD")).toMatch(/border-border/);
  });
});
