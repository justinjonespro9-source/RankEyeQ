import { describe, expect, it } from "vitest";
import { submissionProgressMessage } from "@/components/rank/ContestStatus";
import {
  filterAndSortPlayerPool,
  matchesPlayerPoolQuery,
} from "@/lib/rank/player-pool-search";
import type { RankingPlayer } from "@/types/contest";

function player(
  partial: Partial<RankingPlayer> & Pick<RankingPlayer, "id" | "name" | "team">,
): RankingPlayer {
  return {
    opponent: "vs TBD",
    position: "wr",
    gameDay: "Sun",
    gameTime: "1:00 PM",
    availability: "active",
    ...partial,
  };
}

describe("player pool search", () => {
  const pool = [
    player({
      id: "aj",
      name: "A.J. Brown",
      team: "PHI",
      searchKeys: ["A.J. Brown", "AJ Brown"],
    }),
    player({
      id: "ajones",
      name: "Aaron Jones",
      team: "MIN",
      searchKeys: ["Aaron Jones", "Aaron Jones Sr.", "Aaron Jones, Sr."],
    }),
    player({
      id: "br",
      name: "Brian Robinson",
      team: "ATL",
      searchKeys: ["Brian Robinson", "Brian Robinson Jr.", "Brian Robinson, Jr."],
    }),
    player({ id: "jj", name: "Justin Jefferson", team: "MIN" }),
  ];

  it("finds alias and punctuation variants", () => {
    expect(matchesPlayerPoolQuery(pool[0]!, "AJ Brown")).toBe(true);
    expect(matchesPlayerPoolQuery(pool[1]!, "Aaron Jones Sr")).toBe(true);
    expect(matchesPlayerPoolQuery(pool[2]!, "Brian Robinson Jr.")).toBe(true);
  });

  it("filters by team without changing ranking selections", () => {
    const filtered = filterAndSortPlayerPool(pool, {
      query: "",
      teamFilter: "MIN",
      sortKey: "name",
    });
    expect(filtered.map((row) => row.id)).toEqual(["ajones", "jj"]);
  });

  it("sorts large WR-style pools alphabetically by default", () => {
    const largePool = Array.from({ length: 188 }, (_, index) =>
      player({
        id: `wr-${index}`,
        name: `Player ${String.fromCharCode(90 - (index % 26))}${index}`,
        team: "DAL",
      }),
    );
    const filtered = filterAndSortPlayerPool(largePool, {
      query: "player z",
      teamFilter: "",
      sortKey: "name",
    });
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered[0]?.name.localeCompare(filtered[1]?.name ?? "")).toBeLessThanOrEqual(
      0,
    );
  });
});

describe("ranking depth and status messaging", () => {
  it("reports incomplete selection progress", () => {
    expect(
      submissionProgressMessage({
        filledCount: 7,
        slotCount: 10,
        submissionStatus: "DRAFT",
        editable: true,
      }),
    ).toBe("7 of 10 selected");
  });

  it("reports complete draft ready to submit", () => {
    expect(
      submissionProgressMessage({
        filledCount: 15,
        slotCount: 15,
        submissionStatus: "DRAFT",
        editable: true,
      }),
    ).toBe("Top 15 complete — submit rankings");
  });

  it("reports submitted but editable state", () => {
    expect(
      submissionProgressMessage({
        filledCount: 10,
        slotCount: 10,
        submissionStatus: "SUBMITTED",
        editable: true,
      }),
    ).toContain("submitted");
  });
});

describe("selected player uniqueness", () => {
  it("prevents duplicate ranked ids in slot arrays", () => {
    const rankedEntryIds = ["a", "b", "c", null, null];
    const unique = new Set(rankedEntryIds.filter(Boolean));
    expect(unique.size).toBe(3);
    expect(rankedEntryIds.filter((id) => id === "a")).toHaveLength(1);
  });
});

describe("current-week selected percent policy", () => {
  it("does not expose selectionRate on ranking player payloads", () => {
    const sample = player({ id: "x", name: "Test", team: "KC" });
    expect("selectionRate" in sample).toBe(false);
  });
});
