import { describe, expect, it } from "vitest";
import {
  matchupNotStampedMessage,
  opponentLabelForWeekGame,
  resolveWeekScopedKickoff,
  resolveWeekScopedGame,
} from "@/lib/timing/resolve-contest-kickoff";

describe("resolveWeekScopedKickoff", () => {
  const weekId = "week-2";
  const week1Game = {
    id: "g1",
    weekId: "week-1",
    homeTeam: "LAR",
    awayTeam: "SF",
    startsAt: new Date("2026-09-11T00:35:00.000Z"),
  };
  const week2Game = {
    id: "g2",
    weekId: "week-2",
    homeTeam: "LAR",
    awayTeam: "NYG",
    startsAt: new Date("2026-09-22T00:15:00.000Z"),
  };

  it("uses ContestEntry.game only when it belongs to the contest week", () => {
    expect(
      resolveWeekScopedKickoff({
        weekId,
        contestGame: week2Game,
      })?.toISOString(),
    ).toBe(week2Game.startsAt.toISOString());

    expect(
      resolveWeekScopedKickoff({
        weekId,
        contestGame: week1Game,
      }),
    ).toBeNull();
  });

  it("never treats a missing contest game as a prior-week RankableEntry kickoff", () => {
    expect(
      resolveWeekScopedKickoff({
        weekId,
        contestGame: null,
      }),
    ).toBeNull();
  });

  it("can resolve from this week's schedule by team", () => {
    const game = resolveWeekScopedGame({
      weekId,
      team: "LAR",
      weekGames: [week2Game, week1Game],
    });
    expect(game?.id).toBe("g2");
    expect(opponentLabelForWeekGame("LAR", game)).toBe("vs NYG");
  });

  it("builds the operator-facing not-stamped message", () => {
    expect(matchupNotStampedMessage(2)).toBe(
      "Week 2 matchup data has not been stamped. Import the Week 2 schedule before opening rankings.",
    );
  });
});
