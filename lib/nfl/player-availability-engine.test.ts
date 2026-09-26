import { describe, expect, it } from "vitest";
import { mapNflComStatusToSeasonFields } from "@/lib/nfl/roster-status";
import {
  applyConflictWriteSuppression,
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
import {
  isRosterUnavailableStatus,
  resolvePlayerWeekStatus,
} from "@/lib/eligibility/player-week-availability";
import {
  canNewlySelectPlayer,
  isSelectableUiAvailability,
  mapNflStatusToAvailability,
} from "@/lib/eligibility/weekly-status";
import { mapAvailability } from "@/lib/rankable-mappers";
import { isPromotionUnavailable } from "@/lib/reserves/promotion-status";

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

  it("A: same externalId on two NFL.com teams suppresses all writes", () => {
    const pool = [
      poolEntry({
        name: "Ihmir Smith-Marsette",
        team: "ARI",
        position: "WR",
        externalId: "ihmir-smith-marsette",
        nflStatus: "PRACTICE_SQUAD",
        sourceNflStatus: "DEV",
        activeOnNFLRoster: false,
      }),
    ];
    const live = [
      livePlayer({
        externalId: "ihmir-smith-marsette",
        name: "Ihmir Smith-Marsette",
        team: "ARI",
        sourceStatus: "TRD",
        fantasyPosition: "WR",
        sourcePosition: "WR",
      }),
      livePlayer({
        externalId: "ihmir-smith-marsette",
        name: "Ihmir Smith-Marsette",
        team: "CAR",
        sourceStatus: "DEV",
        fantasyPosition: "WR",
        sourcePosition: "WR",
      }),
    ];
    const matches = buildRosterStatusMatches(pool, live);
    expect(matches.every((m) => m.matchClass !== "MATCHED")).toBe(true);
    expect(matches.every((m) => m.next === null && m.changed === false)).toBe(
      true,
    );
    expect(
      matches.some((m) => m.reason?.includes("SKIP — TEAM/IDENTITY CONFLICT")),
    ).toBe(true);
    expect(matches.some((m) => m.reason?.includes("ARI/TRD"))).toBe(true);
    expect(matches.some((m) => m.reason?.includes("CAR/DEV"))).toBe(true);
  });

  it("B: exact MATCHED row is also SKIPPED when a TEAM_CONFLICT exists", () => {
    const pool = [poolEntry()];
    const live = [
      livePlayer({ team: "NYG", sourceStatus: "RES" }),
      livePlayer({ team: "DAL", sourceStatus: "ACT" }),
    ];
    const matches = buildRosterStatusMatches(pool, live);
    const forDart = matches.filter((m) => m.pool.seasonPlayerId === "sp1");
    expect(forDart.length).toBeGreaterThanOrEqual(2);
    expect(forDart.every((m) => m.matchClass === "TEAM_CONFLICT")).toBe(true);
    expect(forDart.every((m) => m.next === null)).toBe(true);
  });

  it("C: two different players with same normalized name stay independent", () => {
    const pool = [
      poolEntry({
        rankableEntryId: "re-ari",
        seasonPlayerId: "sp-ari",
        name: "John Smith",
        team: "ARI",
        position: "WR",
        externalId: "john-smith-ari",
        nflStatus: "ACTIVE",
        sourceNflStatus: "ACT",
      }),
      poolEntry({
        rankableEntryId: "re-car",
        seasonPlayerId: "sp-car",
        name: "John Smith",
        team: "CAR",
        position: "WR",
        externalId: "john-smith-car",
        nflStatus: "PRACTICE_SQUAD",
        sourceNflStatus: "DEV",
        activeOnNFLRoster: false,
      }),
    ];
    const live = [
      livePlayer({
        externalId: "john-smith-ari",
        name: "John Smith",
        team: "ARI",
        sourceStatus: "RES",
        fantasyPosition: "WR",
        sourcePosition: "WR",
      }),
      livePlayer({
        externalId: "john-smith-car",
        name: "John Smith",
        team: "CAR",
        sourceStatus: "ACT",
        fantasyPosition: "WR",
        sourcePosition: "WR",
      }),
    ];
    const matches = buildRosterStatusMatches(pool, live);
    const ari = matches.find((m) => m.pool.seasonPlayerId === "sp-ari");
    const car = matches.find((m) => m.pool.seasonPlayerId === "sp-car");
    expect(ari?.matchClass).toBe("MATCHED");
    expect(ari?.next?.nflStatus).toBe("IR");
    expect(car?.matchClass).toBe("MATCHED");
    expect(car?.next?.nflStatus).toBe("ACTIVE");
  });

  it("D: ordinary clean externalId + team match WOULD APPLY", () => {
    const matches = buildRosterStatusMatches([poolEntry()], [livePlayer()]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.matchClass).toBe("MATCHED");
    expect(matches[0]!.changed).toBe(true);
    expect(matches[0]!.next?.nflStatus).toBe("IR");
  });

  it("name-only IDENTITY_CONFLICT does not suppress a different externalId MATCHED", () => {
    const pool = [
      poolEntry({
        name: "Chris Moore",
        team: "BAL",
        position: "WR",
        externalId: "chris-moore",
        nflStatus: "PRACTICE_SQUAD",
        sourceNflStatus: "DEV",
        activeOnNFLRoster: false,
      }),
    ];
    const live = [
      livePlayer({
        externalId: "chris-moore",
        name: "Chris Moore",
        team: "BAL",
        sourceStatus: "ACT",
        fantasyPosition: "WR",
        sourcePosition: "WR",
      }),
      // Different person, same display name, no shared externalId
      livePlayer({
        externalId: "chris-moore-xfl",
        name: "Chris Moore",
        team: "DET",
        sourceStatus: "DEV",
        fantasyPosition: "WR",
        sourcePosition: "WR",
      }),
    ];
    const matches = buildRosterStatusMatches(pool, live);
    const bal = matches.find(
      (m) => m.live?.team === "BAL" && m.pool.externalId === "chris-moore",
    );
    expect(bal?.matchClass).toBe("MATCHED");
    expect(bal?.next?.nflStatus).toBe("ACTIVE");
    expect(
      matches.some(
        (m) => m.matchClass === "IDENTITY_CONFLICT" && m.live?.team === "DET",
      ),
    ).toBe(true);
  });
});

describe("TRD / TRC hard-unavailable", () => {
  for (const code of ["TRD", "TRC"] as const) {
    it(`${code} maps off-roster and resolves hard-unavailable`, () => {
      const mapped = mapNflComStatusToSeasonFields(code);
      expect(mapped.nflStatus).toBe(code);
      expect(mapped.activeOnNFLRoster).toBe(false);
      expect(isRosterUnavailableStatus(mapped.nflStatus)).toBe(true);
      expect(mapNflStatusToAvailability(mapped.nflStatus)).toBe("FREE_AGENT");

      const resolved = resolvePlayerWeekStatus({
        nflStatus: mapped.nflStatus,
        weekDesignation: null,
      });
      expect(resolved.rosterUnavailable).toBe(true);
      expect(resolved.selectable).toBe(false);
      expect(resolved.promotionUnavailable).toBe(true);
      expect(resolved.effectiveEntryAvailability).toBe("FREE_AGENT");
      expect(isPromotionUnavailable(resolved.effectiveEntryAvailability)).toBe(
        true,
      );

      const ui = mapAvailability(resolved.effectiveEntryAvailability);
      expect(isSelectableUiAvailability(ui)).toBe(false);
      expect(
        canNewlySelectPlayer({
          availability: resolved.effectiveEntryAvailability,
        }),
      ).toBe(false);

      const { eligible, unavailable } = partitionAiPromptPlayers([
        {
          name: "Traded Player",
          team: "ARI",
          opponent: "vs X",
          gameStartsAt: new Date("2026-09-27T17:00:00.000Z"),
          availability: resolved.effectiveEntryAvailability,
          designation: resolved.designation,
          injuryDescription: null,
          unavailableReason: resolved.unavailableReason,
          rankableEntryId: "traded",
        },
      ]);
      expect(eligible).toHaveLength(0);
      expect(unavailable).toHaveLength(1);
    });
  }

  it("clean non-conflicted TRD WOULD APPLY as hard-unavailable status", () => {
    const matches = buildRosterStatusMatches(
      [
        poolEntry({
          name: "Solo Trade Marker",
          team: "ARI",
          position: "WR",
          externalId: "solo-trade",
          nflStatus: "PRACTICE_SQUAD",
          sourceNflStatus: "DEV",
          activeOnNFLRoster: false,
        }),
      ],
      [
        livePlayer({
          externalId: "solo-trade",
          name: "Solo Trade Marker",
          team: "ARI",
          sourceStatus: "TRD",
          fantasyPosition: "WR",
          sourcePosition: "WR",
        }),
      ],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]!.matchClass).toBe("MATCHED");
    expect(matches[0]!.next).toEqual({
      nflStatus: "TRD",
      sourceNflStatus: "TRD",
      activeOnNFLRoster: false,
    });
    const resolved = resolvePlayerWeekStatus({
      nflStatus: matches[0]!.next!.nflStatus,
    });
    expect(resolved.selectable).toBe(false);
  });
});

describe("conflict suppression helper", () => {
  it("applyConflictWriteSuppression is idempotent on already-suppressed rows", () => {
    const matches = buildRosterStatusMatches(
      [poolEntry()],
      [
        livePlayer({ team: "NYG", sourceStatus: "RES" }),
        livePlayer({ team: "DAL", sourceStatus: "ACT" }),
      ],
    );
    const again = applyConflictWriteSuppression(matches);
    expect(again.every((m) => m.matchClass !== "MATCHED")).toBe(true);
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
        designationChanges: 0,
        practiceContextOnlyChanges: 0,
        injuryDescriptionOnlyChanges: 0,
        practiceTierCounts: { DNP: 0, LIMITED: 0, FULL: 0, UNKNOWN: 0 },
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
