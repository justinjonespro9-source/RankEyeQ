import { describe, expect, it } from "vitest";
import { extractTopNFromSourceOrder } from "@/lib/benchmarks/parser";

const eligible = [
  { id: "gibbs", name: "Jahmyr Gibbs", team: "DET", shortName: "Gibbs" },
  { id: "bijan", name: "Bijan Robinson", team: "ATL", shortName: "Bijan" },
  { id: "taylor", name: "Jonathan Taylor", team: "IND", shortName: "Taylor" },
  { id: "achane", name: "De'Von Achane", team: "MIA", shortName: "Achane" },
];

describe("benchmark Top-N extraction", () => {
  it("preserves source order and extracts the first eligible Top N", () => {
    const result = extractTopNFromSourceOrder({
      lines: [
        { rank: 1, rawName: "Jahmyr Gibbs" },
        { rank: 2, rawName: "Bijan Robinson" },
        { rank: 3, rawName: "Jonathan Taylor" },
        { rank: 4, rawName: "De'Von Achane" },
        { rank: 5, rawName: "Jahmyr Gibbs" },
      ],
      eligible,
      rankingDepth: 3,
    });
    expect(result.selected.map((row) => row.matchedEntryId)).toEqual([
      "gibbs",
      "bijan",
      "taylor",
    ]);
    expect(result.selected.map((row) => row.rankIqRank)).toEqual([1, 2, 3]);
    expect(result.selected.map((row) => row.sourceRank)).toEqual([1, 2, 3]);
    expect(result.rows.find((row) => row.sourceRank === 4)?.extra).toBe(true);
  });

  it("flags an early ineligible player instead of silently skipping", () => {
    const result = extractTopNFromSourceOrder({
      lines: [
        { rank: 1, rawName: "Derrick Henry" },
        { rank: 2, rawName: "Jahmyr Gibbs" },
        { rank: 3, rawName: "Bijan Robinson" },
        { rank: 4, rawName: "Jonathan Taylor" },
      ],
      eligible,
      rankingDepth: 3,
      universe: [
        ...eligible,
        { id: "henry", name: "Derrick Henry", team: "BAL", shortName: "Henry" },
      ],
    });
    expect(result.ready).toBe(false);
    expect(result.rows[0].issue).toBe("ineligible");
    expect(result.rows[0].selected).toBe(false);
    expect(result.blockingIssues.some((item) => /Confirm exclusion/.test(item))).toBe(
      true,
    );
  });

  it("continues extraction after admin confirms an ineligible exclusion", () => {
    const result = extractTopNFromSourceOrder({
      lines: [
        { rank: 1, rawName: "Derrick Henry" },
        { rank: 2, rawName: "Jahmyr Gibbs" },
        { rank: 3, rawName: "Bijan Robinson" },
        { rank: 4, rawName: "Jonathan Taylor" },
      ],
      eligible,
      rankingDepth: 3,
      universe: [
        ...eligible,
        { id: "henry", name: "Derrick Henry", team: "BAL", shortName: "Henry" },
      ],
      confirmedExclusions: [{ sourceRank: 1, reason: "Not in contest pool" }],
    });
    expect(result.ready).toBe(true);
    expect(result.selected.map((row) => row.matchedEntryId)).toEqual([
      "gibbs",
      "bijan",
      "taylor",
    ]);
    expect(result.rows[0].excluded).toBe(true);
  });

  it("never silently guesses an ambiguous name", () => {
    const result = extractTopNFromSourceOrder({
      lines: [{ rank: 1, rawName: "Williams" }],
      eligible: [
        ...eligible,
        { id: "jamo", name: "Jameson Williams", team: "DET", shortName: "Jamo" },
        { id: "kyren", name: "Kyren Williams", team: "LAR", shortName: "Kyren" },
      ],
      rankingDepth: 3,
    });
    expect(result.rows[0].issue).toBe("ambiguous");
    expect(result.rows[0].matchedEntryId).toBeNull();
    expect(result.ready).toBe(false);
  });
});
