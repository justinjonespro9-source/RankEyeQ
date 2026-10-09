import { describe, expect, it } from "vitest";
import { cleanRankedListName, isRankedListHeaderRow, matchNumberedRankedLine, pickRankedListColumns } from "@/lib/text/ranked-list-lines";

describe("ranked-list line helpers", () => {
  it("matches numbered lines and returns the uncleaned name", () => {
    expect(matchNumberedRankedLine("1. **Bijan Robinson** (ATL)")).toEqual({ rank: 1, rawName: "**Bijan Robinson** (ATL)" });
    expect(matchNumberedRankedLine("## 12) Puka Nacua")).toEqual({ rank: 12, rawName: "Puka Nacua" });
    expect(matchNumberedRankedLine("0. Nobody")).toBeNull();
    expect(matchNumberedRankedLine("Bijan Robinson")).toBeNull();
  });

  it("cleans bullets, emphasis and a trailing parenthetical", () => {
    expect(cleanRankedListName("- **Bijan Robinson** (ATL)")).toBe("Bijan Robinson");
    expect(cleanRankedListName("__Puka Nacua__")).toBe("Puka Nacua");
  });

  it("detects header rows and picks rank/name columns", () => {
    expect(isRankedListHeaderRow(["Rank", "Player", "Team"])).toBe(true);
    expect(isRankedListHeaderRow(["1", "Player"])).toBe(false);
    expect(pickRankedListColumns(["3", "Puka Nacua", "LAR"])).toEqual({ rank: 3, rawName: "Puka Nacua" });
    expect(pickRankedListColumns(["Puka Nacua"])).toEqual({ rank: null, rawName: "Puka Nacua" });
    expect(pickRankedListColumns(["0", "Puka Nacua"])).toEqual({ rank: 0, rawName: "Puka Nacua" });
  });
});
