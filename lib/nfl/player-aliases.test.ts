import { describe, expect, it } from "vitest";
import {
  addPlayerAliases,
  parsePlayerAliases,
  rankableEntryMatchesImportName,
} from "@/lib/nfl/player-aliases";
import { findNameMatches, toEligibleParserEntry } from "@/lib/admin/ai-parser";
import { playerNamesCanMerge } from "@/lib/nfl/player-identity";

describe("player aliases", () => {
  it("stores and parses alias lines in adminNotes", () => {
    const notes = addPlayerAliases(null, [
      "Brian Robinson Jr.",
      "Brian Robinson, Jr.",
    ]);
    expect(parsePlayerAliases(notes)).toEqual([
      "Brian Robinson Jr.",
      "Brian Robinson, Jr.",
    ]);
  });

  it("resolves Brian Robinson suffix variants to the canonical player", () => {
    const canonical = {
      name: "Brian Robinson",
      adminNotes: addPlayerAliases(null, [
        "Brian Robinson Jr.",
        "Brian Robinson, Jr.",
      ]),
    };

    for (const variant of [
      "Brian Robinson",
      "Brian Robinson Jr.",
      "Brian Robinson, Jr.",
    ]) {
      expect(rankableEntryMatchesImportName(canonical, variant)).toBe(true);
      expect(
        findNameMatches(variant, [toEligibleParserEntry({ ...canonical, id: "br", team: "ATL" })]),
      ).toHaveLength(1);
    }

    expect(playerNamesCanMerge("Brian Robinson", "Brian Robinson Jr.")).toBe(
      false,
    );
  });
});
