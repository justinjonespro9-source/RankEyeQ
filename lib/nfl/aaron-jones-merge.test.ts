import { describe, expect, it } from "vitest";
import { findNameMatches, toEligibleParserEntry } from "@/lib/admin/ai-parser";
import { addPlayerAliases } from "@/lib/nfl/player-aliases";

describe("Aaron Jones alias merge", () => {
  it("resolves Aaron Jones suffix variants to one canonical player", () => {
    const canonical = {
      id: "aj-canonical",
      name: "Aaron Jones",
      team: "MIN",
      adminNotes: addPlayerAliases(null, [
        "Aaron Jones Sr.",
        "Aaron Jones, Sr.",
      ]),
    };

    for (const variant of [
      "Aaron Jones",
      "Aaron Jones Sr.",
      "Aaron Jones, Sr.",
    ]) {
      expect(
        findNameMatches(variant, [toEligibleParserEntry(canonical)]),
      ).toHaveLength(1);
    }
  });
});
