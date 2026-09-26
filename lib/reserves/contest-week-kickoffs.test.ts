import { describe, expect, it } from "vitest";
import { buildContestWeekKickoffMap } from "@/lib/reserves/contest-week-kickoffs";
import { zonedLocalToUtc } from "@/lib/timing/chicago";

describe("buildContestWeekKickoffMap", () => {
  const weekId = "w2";
  const kickoff = zonedLocalToUtc(2026, 9, 21, 19, 15);

  it("maps matching ContestEntry.game startsAt", () => {
    const map = buildContestWeekKickoffMap({
      weekId,
      entries: [
        {
          rankableEntryId: "a",
          game: {
            id: "1",
            weekId,
            homeTeam: "H",
            awayTeam: "A",
            startsAt: kickoff,
          },
        },
      ],
    });
    expect(map.get("a")).toEqual(kickoff);
  });

  it("records null for missing game rather than omitting the key", () => {
    const map = buildContestWeekKickoffMap({
      weekId,
      entries: [{ rankableEntryId: "a", game: null }],
    });
    expect(map.has("a")).toBe(true);
    expect(map.get("a")).toBeNull();
  });
});
