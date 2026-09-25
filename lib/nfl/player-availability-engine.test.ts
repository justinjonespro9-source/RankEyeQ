import { describe, expect, it } from "vitest";
import { mapNflComStatusToSeasonFields } from "@/lib/nfl/roster-status";
import {
  buildRosterStatusMatches,
  matchRosterPlayerToPool,
  type RosterStatusPoolEntry,
} from "@/lib/nfl/roster-status-sync";
import type { NormalizedRosterPlayer } from "@/lib/providers/nfl/nflcom/fetch-rosters";
import {
  formatPlayerAvailabilityOperatorMessage,
  type PlayerAvailabilityEngineResult,
} from "@/lib/nfl/player-availability-engine";
import { partitionAiPromptPlayers } from "@/lib/admin/ai-prompt";
import { resolvePlayerWeekStatus } from "@/lib/eligibility/player-week-availability";

function poolEntry(
  overrides: Partial<RosterStatusPoolEntry> = {},
): RosterStatusPoolEntry {
  return {
    rankableEntryId: "re1",
    seasonPlayerId: "sp1",
    name: "Jaxson Dart",
    team: "NYG",
    position: "QB",
    externalId: "jaxson-dart",
    provider: "nflcom-bootstrap",
    adminNotes: null,
    nflStatus: "ACTIVE",
    sourceNflStatus: "ACT",
    activeOnNFLRoster: true,
    ...overrides,
  };
}

function livePlayer(
  overrides: Partial<NormalizedRosterPlayer> = {},
): NormalizedRosterPlayer {
  return {
    externalId: "jaxson-dart",
    name: "Jaxson Dart",
    jerseyNumber: "6",
    sourcePosition: "QB",
    sourceStatus: "RES",
    height: "",
    weight: "",
    experience: "",
    college: "",
    team: "NYG",
    fantasyPosition: "QB",
    rosterUrl: "https://www.nfl.com/teams/new-york-giants/roster/",
    ...overrides,
  };
}

describe("incremental roster status matching", () => {
  it("matches by externalId and proposes IR for RES", () => {
    const mapped = mapNflComStatusToSeasonFields("RES");
    expect(mapped.nflStatus).toBe("IR");

    const matches = buildRosterStatusMatches([poolEntry()], [livePlayer()]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.matchClass).toBe("MATCHED");
    expect(matches[0]!.changed).toBe(true);
    expect(matches[0]!.next).toEqual({
      nflStatus: "IR",
      sourceNflStatus: "RES",
      activeOnNFLRoster: false,
    });
  });

  it("classifies TEAM_CONFLICT when externalId matches different team", () => {
    const result = matchRosterPlayerToPool(livePlayer({ team: "DAL" }), [
      poolEntry({ team: "NYG" }),
    ]);
    expect(result.matchClass).toBe("TEAM_CONFLICT");
    expect(result.poolEntry).not.toBeNull();
  });

  it("classifies IDENTITY_CONFLICT for name-only cross-team hits", () => {
    const result = matchRosterPlayerToPool(
      livePlayer({ externalId: "other-id", team: "DAL" }),
      [poolEntry({ externalId: "jaxson-dart", team: "NYG" })],
    );
    expect(result.matchClass).toBe("IDENTITY_CONFLICT");
    expect(result.poolEntry).toBeNull();
  });
});

describe("player availability operator message", () => {
  it("formats source-separated roster and injury coverage", () => {
    const result = {
      ok: true,
      apply: false,
      weekId: "w3",
      seasonId: "s",
      roster: {
        ok: true,
        apply: false,
        syncedAt: new Date("2026-09-24T23:00:00.000Z"),
        source: "nfl.com",
        teamCount: 32,
        liveFantasyPlayers: 795,
        poolSize: 500,
        matched: 503,
        unchanged: 484,
        updated: 19,
        skippedConflicts: 2,
        unmatchedLive: 10,
        byNextStatus: { IR: 17, CUT: 1, PRACTICE_SQUAD: 1 },
        matches: [],
        fetchErrors: [],
        errors: [],
      },
      injury: {
        ok: true,
        source: "nfl.com" as const,
        sourceUrl: "https://www.nfl.com/injuries/",
        syncedAt: new Date("2026-09-24T23:00:00.000Z"),
        sourceRowCount: 290,
        officialGameStatusCount: 12,
        blankGameStatusCount: 278,
        matched: 84,
        updated: 0,
        unchanged: 84,
        skippedManual: 0,
        skippedKickoff: 0,
        failed: 0,
        questionable: 0,
        doubtful: 0,
        out: 1,
        unmatched: 3,
        ambiguous: 0,
        errors: [],
        matches: [],
        skippedNonFantasy: 0,
      },
      resolved: {
        eligible: 500,
        rosterUnavailable: 19,
        weeklyOut: 1,
        weeklyInactive: 0,
        weeklyQuestionable: 0,
        weeklyDoubtful: 0,
        noOfficialStatus: 480,
      },
      operatorMessage: "",
      errors: [],
    } satisfies PlayerAvailabilityEngineResult;

    const message = formatPlayerAvailabilityOperatorMessage(result);
    expect(message).toContain("PLAYER AVAILABILITY PREVIEW");
    expect(message).toContain("32 teams");
    expect(message).toContain("19 status changes proposed");
    expect(message).toContain("290 rows fetched");
    expect(message).toContain("12 official Game Status");
    expect(message).toContain("19 roster-unavailable");
  });
});

describe("AI pool excludes Reserve/Injured before weekly OUT", () => {
  it("Dart IR + blank GS is unavailable to AI eligible pool", () => {
    const resolved = resolvePlayerWeekStatus({
      nflStatus: "IR",
      weekDesignation: null,
    });
    expect(resolved.selectable).toBe(false);
    expect(resolved.unavailableReason).toBe("IR");

    const { eligible, unavailable } = partitionAiPromptPlayers([
      {
        name: "Jaxson Dart",
        team: "NYG",
        opponent: "vs TEN",
        gameStartsAt: new Date("2026-09-27T17:00:00.000Z"),
        availability: resolved.effectiveEntryAvailability,
        designation: resolved.designation,
        injuryDescription: null,
        unavailableReason: resolved.unavailableReason,
        rankableEntryId: "dart",
      },
      {
        name: "Jameis Winston",
        team: "NYG",
        opponent: "vs TEN",
        gameStartsAt: new Date("2026-09-27T17:00:00.000Z"),
        availability: "ACTIVE",
        designation: "UNKNOWN",
        injuryDescription: null,
        unavailableReason: null,
        rankableEntryId: "winston",
      },
    ]);

    expect(eligible.map((p) => p.name)).toEqual(["Jameis Winston"]);
    expect(unavailable.map((p) => p.name)).toEqual(["Jaxson Dart"]);
  });
});
