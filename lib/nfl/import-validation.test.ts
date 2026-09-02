import { describe, expect, it } from "vitest";
import {
  validateProviderWeekResults,
  validateWeeklyImportBundle,
} from "@/lib/nfl/import-validation";
import type {
  ProviderWeekResults,
  WeeklyEligibleBundle,
} from "@/lib/providers/nfl/types";

const kickoff = new Date("2026-09-10T17:00:00.000Z");

function validBundle(): WeeklyEligibleBundle {
  return {
    seasonYear: 2026,
    weekNumber: 1,
    games: [
      {
        externalId: "g1",
        seasonYear: 2026,
        weekNumber: 1,
        homeTeam: "KC",
        awayTeam: "BUF",
        startsAt: kickoff,
        status: "SCHEDULED",
      },
    ],
    players: [
      {
        externalId: "p1",
        name: "QB One",
        shortName: "QB1",
        team: "KC",
        position: "QB",
        headshotUrl: null,
        active: true,
        gameExternalId: "g1",
        opponent: "BUF",
        gameStartsAt: kickoff,
      },
    ],
    defenses: [
      {
        externalId: "d-kc",
        team: "KC",
        name: "KC D/ST",
        shortName: "KC",
        headshotUrl: null,
        active: true,
        gameExternalId: "g1",
        opponent: "BUF",
        gameStartsAt: kickoff,
      },
      {
        externalId: "d-buf",
        team: "BUF",
        name: "BUF D/ST",
        shortName: "BUF",
        headshotUrl: null,
        active: true,
        gameExternalId: "g1",
        opponent: "KC",
        gameStartsAt: kickoff,
      },
    ],
    invalid: [],
  };
}

describe("provider import validation", () => {
  it("rejects empty and malformed weekly imports", () => {
    const empty = validateWeeklyImportBundle(
      {
        seasonYear: 2026,
        weekNumber: 1,
        games: [],
        players: [],
        defenses: [],
        invalid: [],
      },
      { seasonYear: 2026, weekNumber: 1 },
    );
    expect(empty.ok).toBe(false);
    expect(empty.issues.some((issue) => issue.code === "empty_schedule")).toBe(true);

    const malformed = validBundle();
    malformed.games[0].startsAt = new Date("invalid");
    malformed.players[0].opponent = "";
    malformed.players.push({ ...malformed.players[0], externalId: "p1" });
    const result = validateWeeklyImportBundle(malformed, {
      seasonYear: 2026,
      weekNumber: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "malformed_kickoff")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "missing_opponent")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "duplicate_provider_ids")).toBe(
      true,
    );
  });

  it("rejects games outside the selected week and DEF gaps", () => {
    const bundle = validBundle();
    bundle.games[0].weekNumber = 2;
    bundle.defenses = bundle.defenses.filter((row) => row.team === "KC");
    const result = validateWeeklyImportBundle(bundle, {
      seasonYear: 2026,
      weekNumber: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "game_outside_week")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "def_gap")).toBe(true);
  });

  it("rejects empty stats and provisional rows marked final", () => {
    const emptyStats = validateProviderWeekResults({
      seasonYear: 2026,
      weekNumber: 1,
      games: [],
      playerStats: [],
      defenseStats: [],
      unmatched: [],
    });
    expect(emptyStats.ok).toBe(false);

    const mismatch: ProviderWeekResults = {
      seasonYear: 2026,
      weekNumber: 1,
      games: [
        {
          externalId: "g1",
          seasonYear: 2026,
          weekNumber: 1,
          homeTeam: "KC",
          awayTeam: "BUF",
          startsAt: kickoff,
          status: "IN_PROGRESS",
        },
      ],
      playerStats: [
        {
          externalPlayerId: "p1",
          team: "KC",
          gameExternalId: "g1",
          isGameFinal: true,
          passingYards: 0,
          passingTds: 0,
          interceptions: 0,
          rushingYards: 0,
          rushingTds: 0,
          receptions: 0,
          receivingYards: 0,
          receivingTds: 0,
          twoPointConversions: 0,
          fumblesLost: 0,
          returnTds: 0,
        },
      ],
      defenseStats: [
        {
          externalId: "d-kc",
          team: "KC",
          gameExternalId: "g1",
          isGameFinal: true,
          sacks: 0,
          interceptions: 0,
          fumbleRecoveries: 0,
          safeties: 0,
          defensiveTds: 0,
          specialTeamsTds: 0,
          blockedKicks: 0,
          pointsAllowed: 0,
        },
      ],
      unmatched: [],
    };
    const result = validateProviderWeekResults(mismatch, { requireFinal: true });
    expect(result.ok).toBe(false);
    expect(
      result.issues.some((issue) => issue.code === "provisional_marked_final"),
    ).toBe(true);
  });
});
