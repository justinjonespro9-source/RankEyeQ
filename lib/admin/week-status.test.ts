import { describe, expect, it } from "vitest";
import { resolveWeekStatusMatchup } from "@/lib/admin/week-status";
import {
  presentWeeklyAvailability,
  resolvePlayerWeekStatus,
} from "@/lib/eligibility/player-week-availability";

describe("resolveWeekStatusMatchup", () => {
  const week2Id = "week-2";
  const week1Id = "week-1";
  const week2Game = {
    id: "g2",
    weekId: week2Id,
    homeTeam: "LAR",
    awayTeam: "NYG",
    startsAt: new Date("2026-09-22T00:15:00.000Z"),
  };
  const week1Game = {
    id: "g1",
    weekId: week1Id,
    homeTeam: "SF",
    awayTeam: "SEA",
    startsAt: new Date("2026-09-11T00:20:00.000Z"),
  };

  it("displays Week 2 ContestEntry game even when master Week 1 fields are poisoned", () => {
    const poisonedMasterKickoff = new Date("2026-09-10T23:15:00.000Z");
    expect(poisonedMasterKickoff.toISOString()).not.toBe(
      week2Game.startsAt.toISOString(),
    );

    const matchup = resolveWeekStatusMatchup({
      weekId: week2Id,
      team: "LAR",
      contestGame: week2Game,
      excluded: false,
    });

    expect(matchup.matchupMissing).toBe(false);
    expect(matchup.kickoffAt?.toISOString()).toBe(
      "2026-09-22T00:15:00.000Z",
    );
    expect(matchup.opponent).toBe("vs NYG");
  });

  it("rejects a prior-week ContestEntry.game and fails visibly", () => {
    const matchup = resolveWeekStatusMatchup({
      weekId: week2Id,
      team: "SF",
      contestGame: week1Game,
      excluded: false,
    });
    expect(matchup.matchupMissing).toBe(true);
    expect(matchup.kickoffAt).toBeNull();
    expect(matchup.opponent).toBe("MISSING");
  });

  it("shows operator error when ContestEntry has no game", () => {
    const matchup = resolveWeekStatusMatchup({
      weekId: week2Id,
      team: "NE",
      contestGame: null,
    });
    expect(matchup.matchupMissing).toBe(true);
    expect(matchup.kickoffAt).toBeNull();
    expect(matchup.opponent).toBe("MISSING");
  });

  it("does not flag excluded entries without a game as matchup errors", () => {
    const matchup = resolveWeekStatusMatchup({
      weekId: week2Id,
      team: "NE",
      contestGame: null,
      excluded: true,
    });
    expect(matchup.matchupMissing).toBe(false);
    expect(matchup.opponent).toBe("TBD");
  });
});

describe("week-status availability presentation contract", () => {
  it("distinguishes practice-only from official Out", () => {
    const practiceOnly = presentWeeklyAvailability({
      resolved: resolvePlayerWeekStatus({
        nflStatus: "ACTIVE",
        weekDesignation: null,
        fallbackEntryAvailability: "OUT",
      }),
      hasWeekRecord: false,
      practiceStatus: "Did Not Participate In Practice",
      onInjuryReportBlankGameStatus: true,
    });
    expect(practiceOnly.designationLabel).toBe("No official status yet");
    expect(practiceOnly.sourceKind).toBe("PRACTICE_ONLY");

    const official = presentWeeklyAvailability({
      resolved: resolvePlayerWeekStatus({
        nflStatus: "ACTIVE",
        weekDesignation: "OUT",
        sourceType: "NFL_SYNC",
      }),
      hasWeekRecord: true,
      onInjuryReportOfficialGameStatus: true,
    });
    expect(official.designationLabel).toBe("Out");
    expect(official.sourceKind).toBe("OFFICIAL_GAME_STATUS");
  });
});
