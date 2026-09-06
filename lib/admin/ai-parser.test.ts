import { describe, expect, it } from "vitest";
import {
  matchParsedRankings,
  parseNumberedRankingLines,
  parseRankingPaste,
  parseTabDelimitedRankingLines,
  previewIsReadyToSubmit,
} from "@/lib/admin/ai-parser";

const eligible = [
  { id: "gibbs", name: "Jahmyr Gibbs", team: "DET", shortName: "Gibbs" },
  { id: "bijan", name: "Bijan Robinson", team: "ATL", shortName: "Bijan" },
  { id: "taylor", name: "Jonathan Taylor", team: "IND", shortName: "Taylor" },
  { id: "achane", name: "De'Von Achane", team: "MIA", shortName: "Achane" },
];

const universe = [
  ...eligible,
  { id: "henry", name: "Derrick Henry", team: "BAL", shortName: "Henry" },
];

describe("AI response parser", () => {
  it("handles common numbered formats", () => {
    const text = `
1. Jahmyr Gibbs
2) Bijan Robinson
3 - Jonathan Taylor
4 De'Von Achane
`;
    expect(parseNumberedRankingLines(text).map((row) => row.rawName)).toEqual([
      "Jahmyr Gibbs",
      "Bijan Robinson",
      "Jonathan Taylor",
      "De'Von Achane",
    ]);
  });

  it("parses markdown numbered lists and tab-delimited rank/player columns", () => {
    const markdown = `
## Rankings
1. Jahmyr Gibbs
2. Bijan Robinson
`;
    expect(parseNumberedRankingLines(markdown).map((row) => row.rawName)).toEqual(
      ["Jahmyr Gibbs", "Bijan Robinson"],
    );

    const table = [
      "Rank\tPlayer\tTeam",
      "1\tJahmyr Gibbs\tDET",
      "2\tBijan Robinson\tATL",
    ].join("\n");
    expect(parseTabDelimitedRankingLines(table).map((row) => row.rawName)).toEqual(
      ["Jahmyr Gibbs", "Bijan Robinson"],
    );
    expect(parseRankingPaste(table).map((row) => row.rank)).toEqual([1, 2]);
  });

  it("rejects ineligible players", () => {
    const preview = matchParsedRankings({
      lines: [{ rank: 1, rawName: "Derrick Henry" }],
      eligible,
      rankingDepth: 4,
      universe,
    });
    expect(preview.find((row) => row.rank === 1)?.issue).toBe("ineligible");
  });

  it("rejects unknown players", () => {
    const preview = matchParsedRankings({
      lines: [{ rank: 1, rawName: "Not A Real Back" }],
      eligible,
      rankingDepth: 4,
      universe,
    });
    expect(preview.find((row) => row.rank === 1)?.issue).toBe("unknown");
  });

  it("rejects duplicate players and ranks", () => {
    const preview = matchParsedRankings({
      lines: [
        { rank: 1, rawName: "Jahmyr Gibbs" },
        { rank: 1, rawName: "Bijan Robinson" },
        { rank: 2, rawName: "Jahmyr Gibbs" },
      ],
      eligible,
      rankingDepth: 4,
    });
    expect(preview.some((row) => row.issue === "duplicate_rank")).toBe(true);
    expect(preview.some((row) => row.issue === "duplicate_player")).toBe(true);
  });

  it("requires correction for ambiguous last names", () => {
    const preview = matchParsedRankings({
      lines: [{ rank: 1, rawName: "Williams" }],
      eligible: [
        ...eligible,
        { id: "jamo", name: "Jameson Williams", team: "DET", shortName: "Jamo" },
        { id: "kyren", name: "Kyren Williams", team: "LAR", shortName: "Kyren" },
      ],
      rankingDepth: 4,
    });
    expect(preview[0].issue).toBe("ambiguous");
    expect(preview[0].candidates.length).toBeGreaterThan(1);
    expect(preview[0].matchedEntryId).toBeNull();
  });

  it("flags missing ranks and too many picks", () => {
    const preview = matchParsedRankings({
      lines: [
        { rank: 1, rawName: "Jahmyr Gibbs" },
        { rank: 5, rawName: "Bijan Robinson" },
      ],
      eligible,
      rankingDepth: 4,
    });
    expect(preview.some((row) => row.issue === "missing_rank")).toBe(true);
    expect(preview.find((row) => row.rank === 5)?.issue).toBe("too_many");
    expect(previewIsReadyToSubmit(preview, 4)).toBe(false);
  });

  it("requires exact player count before submit is ready", () => {
    const complete = matchParsedRankings({
      lines: [
        { rank: 1, rawName: "Jahmyr Gibbs" },
        { rank: 2, rawName: "Bijan Robinson" },
        { rank: 3, rawName: "Jonathan Taylor" },
        { rank: 4, rawName: "De'Von Achane" },
      ],
      eligible,
      rankingDepth: 4,
    });
    expect(previewIsReadyToSubmit(complete, 4)).toBe(true);

    const short = matchParsedRankings({
      lines: [
        { rank: 1, rawName: "Jahmyr Gibbs" },
        { rank: 2, rawName: "Bijan Robinson" },
      ],
      eligible,
      rankingDepth: 4,
    });
    expect(previewIsReadyToSubmit(short, 4)).toBe(false);
  });

  it("rejects wrong-position players when otherPositions is provided", () => {
    const preview = matchParsedRankings({
      lines: [{ rank: 1, rawName: "Justin Jefferson" }],
      eligible,
      rankingDepth: 4,
      universe,
      otherPositions: [
        {
          id: "jj",
          name: "Justin Jefferson",
          team: "MIN",
          shortName: "Jefferson",
        },
      ],
    });
    expect(preview.find((row) => row.rank === 1)?.issue).toBe("wrong_position");
  });

  it("supports WR Top 15 depth validation", () => {
    const wrEligible = Array.from({ length: 15 }, (_, index) => ({
      id: `wr-${index + 1}`,
      name: `Receiver ${index + 1}`,
      team: "XX",
      shortName: `R${index + 1}`,
    }));
    const lines = wrEligible.map((entry, index) => ({
      rank: index + 1,
      rawName: entry.name,
    }));
    const preview = matchParsedRankings({
      lines,
      eligible: wrEligible,
      rankingDepth: 15,
    });
    expect(previewIsReadyToSubmit(preview, 15)).toBe(true);
    expect(
      previewIsReadyToSubmit(
        matchParsedRankings({
          lines: lines.slice(0, 10),
          eligible: wrEligible,
          rankingDepth: 15,
        }),
        15,
      ),
    ).toBe(false);
  });
});
