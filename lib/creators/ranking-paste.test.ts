import { describe, expect, it } from "vitest";
import {
  parseCommaCsvRankingLines,
  parsePlainOrderedRankingLines,
  parseRankingPaste,
} from "@/lib/admin/ai-parser";
import { extractTopNFromPastedText } from "@/lib/benchmarks/parser";
import { rankingDepthForPosition } from "@/lib/contest-defaults";
import {
  findNextCreatorImportTarget,
  toCreatorImportStatus,
} from "@/lib/creators/coverage";
import {
  parseCreatorRankingPaste,
  parseMultiPositionCreatorPaste,
  parseOrderedTierOrFlat,
} from "@/lib/creators/ranking-paste";
import { formatCreatorAffiliationBadge } from "@/lib/creator-identity";

const eligible = [
  { id: "bijan", name: "Bijan Robinson", team: "ATL", shortName: "Bijan" },
  { id: "gibbs", name: "Jahmyr Gibbs", team: "DET", shortName: "Gibbs" },
  { id: "saquon", name: "Saquon Barkley", team: "PHI", shortName: "Saquon" },
  { id: "achane", name: "Devon Achane", team: "MIA", shortName: "Achane" },
];

describe("creator ranking paste formats", () => {
  it("parses numbered paste", () => {
    const lines = parseRankingPaste(
      `1. Bijan Robinson\n2) Jahmyr Gibbs\n3 - Saquon Barkley`,
    );
    expect(lines.map((row) => row.rawName)).toEqual([
      "Bijan Robinson",
      "Jahmyr Gibbs",
      "Saquon Barkley",
    ]);
  });

  it("parses plain ordered list", () => {
    const lines = parsePlainOrderedRankingLines(
      `Bijan Robinson\nJahmyr Gibbs\nSaquon Barkley`,
    );
    expect(lines).toEqual([
      { rank: 1, rawName: "Bijan Robinson" },
      { rank: 2, rawName: "Jahmyr Gibbs" },
      { rank: 3, rawName: "Saquon Barkley" },
    ]);
  });

  it("parses CSV rank,player", () => {
    const lines = parseCommaCsvRankingLines(
      `rank,player\n1,Bijan Robinson\n2,Jahmyr Gibbs`,
    );
    expect(lines.map((row) => row.rawName)).toEqual([
      "Bijan Robinson",
      "Jahmyr Gibbs",
    ]);
  });

  it("uses WR 15 / others 10 field sizes", () => {
    expect(rankingDepthForPosition("WR")).toBe(15);
    expect(rankingDepthForPosition("RB")).toBe(10);
    expect(rankingDepthForPosition("QB")).toBe(10);
  });
});

describe("creator tiers", () => {
  it("flattens ordered tiers sequentially", () => {
    const result = parseOrderedTierOrFlat(`
Tier 1:
1. Bijan Robinson
2. Jahmyr Gibbs
Tier 2:
Saquon Barkley
Devon Achane
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("ordered_tiers");
    expect(result.lines.map((row) => row.rawName)).toEqual([
      "Bijan Robinson",
      "Jahmyr Gibbs",
      "Saquon Barkley",
      "Devon Achane",
    ]);
  });

  it("rejects ambiguous/unordered tiers", () => {
    const result = parseCreatorRankingPaste(`
Tier 1 (unordered):
Bijan Robinson
Jahmyr Gibbs
Tier 2:
Saquon Barkley
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.mode).toBe("ambiguous_tiers");
    expect(result.error).toMatch(/unordered|ambiguous/i);
  });
});

describe("creator validation against eligible pool", () => {
  it("rejects duplicates and ineligible without silent repair", () => {
    const dup = extractTopNFromPastedText({
      text: `1. Bijan Robinson\n2. Bijan Robinson\n3. Jahmyr Gibbs\n4. Saquon Barkley`,
      eligible,
      rankingDepth: 3,
    });
    expect(dup.ready).toBe(false);
    expect(dup.rows.some((row) => row.issue === "duplicate_player")).toBe(true);

    const bad = extractTopNFromPastedText({
      text: `1. Derrick Henry\n2. Bijan Robinson\n3. Jahmyr Gibbs\n4. Saquon Barkley`,
      eligible,
      rankingDepth: 3,
      universe: [
        ...eligible,
        { id: "henry", name: "Derrick Henry", team: "BAL", shortName: "Henry" },
      ],
    });
    expect(bad.ready).toBe(false);
    expect(bad.rows[0].issue).toBe("ineligible");
    expect(bad.rows[0].matchedEntryId).toBeNull();
  });

  it("surfaces fuzzy suggestions without substituting", () => {
    const result = extractTopNFromPastedText({
      text: `1. Williams`,
      eligible: [
        ...eligible,
        { id: "kyren", name: "Kyren Williams", team: "LAR", shortName: "Kyren" },
        { id: "jamo", name: "Jameson Williams", team: "DET", shortName: "Jamo" },
      ],
      rankingDepth: 1,
    });
    expect(result.ready).toBe(false);
    expect(result.rows[0].issue).toBe("ambiguous");
    expect(result.rows[0].matchedEntryId).toBeNull();
    expect(result.rows[0].candidates.length).toBeGreaterThan(1);
  });
});

describe("creator coverage helpers", () => {
  it("maps benchmark cells to import statuses", () => {
    expect(toCreatorImportStatus("Missing", false)).toBe("Not imported");
    expect(toCreatorImportStatus("Thursday Snapshot", false)).toBe("Draft");
    expect(toCreatorImportStatus("Sunday Snapshot", false)).toBe("Submitted");
    expect(toCreatorImportStatus("Locked", false)).toBe("Submitted");
    expect(toCreatorImportStatus("Sunday Snapshot", true)).toBe("Error");
  });

  it("finds next missing board for fast workflow", () => {
    const rows = [
      {
        profileId: "c1",
        username: "c1",
        displayName: "C1",
        personName: null,
        brandName: "Brand",
        affiliationBadge: "CREATOR · Brand",
        sourceUrl: "https://example.com",
        competitorActive: true,
        cells: {
          QB: "Submitted" as const,
          RB: "Not imported" as const,
          WR: "Not imported" as const,
          TE: "Not imported" as const,
          DEF: "Not imported" as const,
        },
        lateCells: [],
        missingSourceUrlCells: [],
        capturedCount: 1,
        expectedCount: 5,
        missingPositions: ["RB", "WR", "TE", "DEF"] as const,
      },
    ];
    const contestByPosition = new Map<string, string>([
      ["QB", "qb"],
      ["RB", "rb"],
      ["WR", "wr"],
      ["TE", "te"],
      ["DEF", "def"],
    ]);
    const next = findNextCreatorImportTarget({
      rows: rows as never,
      contestByPosition: contestByPosition as never,
      afterProfileId: "c1",
      afterPosition: "QB",
    });
    expect(next).toEqual({ profileId: "c1", contestId: "rb", position: "RB" });
  });

  it("preserves Creator · brand identity formatting", () => {
    expect(
      formatCreatorAffiliationBadge({
        displayName: "Host",
        personName: "Alex",
        brandName: "TCO Fantasy",
      }),
    ).toBe("CREATOR · TCO Fantasy");
  });
});

describe("multi-position creator paste", () => {
  it("splits QB/RB sections independently", () => {
    const { sections } = parseMultiPositionCreatorPaste(`
QB
1. Player A
2. Player B
RB
1. Bijan Robinson
2. Jahmyr Gibbs
`);
    expect(sections.map((section) => section.position)).toEqual(["QB", "RB"]);
    expect(sections[1].lines[0].rawName).toBe("Bijan Robinson");
  });
});
