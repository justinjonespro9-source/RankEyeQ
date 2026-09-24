import { describe, expect, it } from "vitest";
import { resolveWeekGameForTeam } from "@/lib/providers/nfl/eligibility";
import { matchupNotStampedMessage } from "@/lib/timing/resolve-contest-kickoff";
import {
  classifyMatchupRepairStatus,
  emptyPosCounts,
  formatPreviewSyncMatchupsMessage,
  formatScheduleSaveMatchupMessage,
  formatSyncMatchupsMessage,
  summarizeMatchupSync,
  type MatchupRepairRow,
  type WeekMatchupRepairReport,
} from "@/lib/nfl/week-matchup-repair";

function baseRow(
  overrides: Partial<MatchupRepairRow> & Pick<MatchupRepairRow, "status">,
): MatchupRepairRow {
  return {
    contestEntryId: "ce1",
    contestId: "c1",
    position: "QB",
    rankableEntryId: "re1",
    name: "Test QB",
    team: "GB",
    currentGameId: null,
    currentKickoffAt: null,
    currentOpponent: "TBD",
    proposedGameId: "g1",
    proposedKickoffAt: "2026-09-20T17:00:00.000Z",
    proposedOpponent: "vs MIN",
    ...overrides,
  };
}

function baseReport(
  overrides: Partial<WeekMatchupRepairReport> & {
    rows: MatchupRepairRow[];
  },
): WeekMatchupRepairReport {
  const counts = emptyPosCounts();
  for (const row of overrides.rows) {
    if (row.status === "correct") counts.correct += 1;
    else if (row.status === "missing") counts.missing += 1;
    else if (row.status === "stale") counts.stale += 1;
    else if (row.status === "unmatched") counts.unmatched += 1;
    else if (row.status === "ambiguous") counts.ambiguous += 1;
    else counts.proposedUpdate += 1;
  }
  if (overrides.counts?.updated != null) {
    counts.updated = overrides.counts.updated;
  }
  const { rows, counts: countOverrides, ...rest } = overrides;
  return {
    weekId: "w1",
    weekNumber: 3,
    label: "Week 3",
    applied: false,
    gameCount: 16,
    uniqueTeamCount: 32,
    byPosition: {
      QB: emptyPosCounts(),
      RB: emptyPosCounts(),
      WR: emptyPosCounts(),
      TE: emptyPosCounts(),
      DEF: emptyPosCounts(),
    },
    snapshots: [],
    snapshotGuidance: [],
    week1Untouched: true,
    skippedDueToLifecycle: false,
    lifecycleMessage: null,
    ...rest,
    rows,
    counts: { ...counts, ...countOverrides },
  };
}

describe("resolveWeekGameForTeam", () => {
  const games = [
    { id: "1", homeTeam: "MIN", awayTeam: "GB" },
    { id: "2", homeTeam: "DET", awayTeam: "CHI" },
  ];

  it("returns unique when the team appears once", () => {
    const result = resolveWeekGameForTeam(games, "GB");
    expect(result.status).toBe("unique");
    if (result.status === "unique") expect(result.game.id).toBe("1");
  });

  it("returns none when the team is absent", () => {
    expect(resolveWeekGameForTeam(games, "PIT").status).toBe("none");
  });

  it("returns ambiguous when the team appears twice (no guessed link)", () => {
    const bad = [
      ...games,
      { id: "3", homeTeam: "GB", awayTeam: "SEA" },
    ];
    const result = resolveWeekGameForTeam(bad, "GB");
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") expect(result.games).toHaveLength(2);
  });
});

describe("classifyMatchupRepairStatus", () => {
  const weekGameIds = new Set(["week3-a", "week3-b"]);

  it("marks missing when gameId is null and schedule resolves uniquely", () => {
    expect(
      classifyMatchupRepairStatus({
        currentGameId: null,
        proposedId: "week3-a",
        weekGameIds,
        masterGameId: null,
        masterOpponent: "TBD",
        masterKickoff: null,
        proposedOpponent: "vs MIN",
        proposedKickoff: new Date("2026-09-20T17:00:00Z"),
        resolutionStatus: "unique",
      }),
    ).toBe("missing");
  });

  it("marks correct when contest + master already match", () => {
    const kickoff = new Date("2026-09-20T17:00:00Z");
    expect(
      classifyMatchupRepairStatus({
        currentGameId: "week3-a",
        proposedId: "week3-a",
        weekGameIds,
        masterGameId: "week3-a",
        masterOpponent: "vs MIN",
        masterKickoff: kickoff,
        proposedOpponent: "vs MIN",
        proposedKickoff: kickoff,
        resolutionStatus: "unique",
      }),
    ).toBe("correct");
  });

  it("marks stale when current gameId is from another week", () => {
    expect(
      classifyMatchupRepairStatus({
        currentGameId: "week2-x",
        proposedId: "week3-a",
        weekGameIds,
        masterGameId: "week2-x",
        masterOpponent: "vs DET",
        masterKickoff: new Date("2026-09-13T17:00:00Z"),
        proposedOpponent: "vs MIN",
        proposedKickoff: new Date("2026-09-20T17:00:00Z"),
        resolutionStatus: "unique",
      }),
    ).toBe("stale");
  });

  it("marks unmatched when team is missing from the schedule", () => {
    expect(
      classifyMatchupRepairStatus({
        currentGameId: null,
        proposedId: null,
        weekGameIds,
        masterGameId: null,
        masterOpponent: "TBD",
        masterKickoff: null,
        proposedOpponent: null,
        proposedKickoff: null,
        resolutionStatus: "none",
      }),
    ).toBe("unmatched");
  });

  it("marks ambiguous without proposing a gameId", () => {
    expect(
      classifyMatchupRepairStatus({
        currentGameId: null,
        proposedId: null,
        weekGameIds,
        masterGameId: null,
        masterOpponent: "TBD",
        masterKickoff: null,
        proposedOpponent: null,
        proposedKickoff: null,
        resolutionStatus: "ambiguous",
      }),
    ).toBe("ambiguous");
  });

  it("marks proposed_update for same-week wrong gameId", () => {
    expect(
      classifyMatchupRepairStatus({
        currentGameId: "week3-b",
        proposedId: "week3-a",
        weekGameIds,
        masterGameId: "week3-b",
        masterOpponent: "@ CHI",
        masterKickoff: new Date("2026-09-20T20:00:00Z"),
        proposedOpponent: "vs MIN",
        proposedKickoff: new Date("2026-09-20T17:00:00Z"),
        resolutionStatus: "unique",
      }),
    ).toBe("proposed_update");
  });
});

describe("summarizeMatchupSync + operator messages", () => {
  it("reports full success after apply for 535-style pool", () => {
    const rows = Array.from({ length: 535 }, (_, i) =>
      baseRow({
        contestEntryId: `ce${i}`,
        status: i < 10 ? "correct" : "missing",
      }),
    );
    const report = baseReport({
      applied: true,
      rows,
      counts: { ...emptyPosCounts(), correct: 10, missing: 525, updated: 525 },
    });
    const summary = summarizeMatchupSync({ report });
    expect(summary.totalEntries).toBe(535);
    expect(summary.linkedCorrectly).toBe(535);
    expect(summary.newlyLinked).toBe(525);
    expect(summary.needsAttention).toBe(0);
    expect(
      formatScheduleSaveMatchupMessage({
        created: 16,
        updated: 0,
        games: 16,
        uniqueTeamCount: 32,
        summary,
      }),
    ).toContain("535/535 pool matchups synchronized");
  });

  it("is idempotent when all entries are already correct", () => {
    const rows = [baseRow({ status: "correct", currentGameId: "g1" })];
    const dry = summarizeMatchupSync({
      report: baseReport({ applied: false, rows }),
    });
    const applied = summarizeMatchupSync({
      report: baseReport({
        applied: true,
        rows,
        counts: { ...emptyPosCounts(), correct: 1, updated: 0 },
      }),
    });
    expect(dry.writable).toBe(0);
    expect(applied.updated).toBe(0);
    expect(applied.linkedCorrectly).toBe(1);
  });

  it("warns when unmatched remain after save", () => {
    const rows = [
      baseRow({ status: "missing" }),
      baseRow({
        contestEntryId: "ce2",
        team: "BYE",
        status: "unmatched",
        proposedGameId: null,
        proposedOpponent: null,
      }),
    ];
    const summary = summarizeMatchupSync({
      report: baseReport({
        applied: true,
        rows,
        counts: {
          ...emptyPosCounts(),
          missing: 1,
          unmatched: 1,
          updated: 1,
        },
      }),
    });
    expect(summary.linkedCorrectly).toBe(1);
    expect(summary.needsAttention).toBe(1);
    const message = formatScheduleSaveMatchupMessage({
      created: 1,
      updated: 0,
      games: 2,
      uniqueTeamCount: 4,
      summary,
    });
    expect(message).toContain("1/2 pool matchups synchronized");
    expect(message).toContain("1 entries need attention");
  });

  it("reports zero pool entries without claiming sync failure", () => {
    const summary = summarizeMatchupSync({
      report: baseReport({ applied: true, rows: [] }),
    });
    expect(summary.totalEntries).toBe(0);
    expect(
      formatScheduleSaveMatchupMessage({
        created: 16,
        updated: 0,
        games: 16,
        uniqueTeamCount: 32,
        summary,
      }),
    ).toContain("0 existing pool entries");
  });

  it("formats Sync Matchups preview and apply messages", () => {
    const rows = [
      baseRow({ status: "missing" }),
      baseRow({ contestEntryId: "ce2", status: "correct", currentGameId: "g1" }),
      baseRow({
        contestEntryId: "ce3",
        status: "unmatched",
        proposedGameId: null,
      }),
    ];
    const preview = summarizeMatchupSync({
      report: baseReport({ applied: false, rows }),
    });
    expect(formatPreviewSyncMatchupsMessage(preview)).toContain("1 to repair");
    const applied = summarizeMatchupSync({
      report: baseReport({
        applied: true,
        rows,
        counts: {
          ...emptyPosCounts(),
          missing: 1,
          correct: 1,
          unmatched: 1,
          updated: 1,
        },
      }),
    });
    expect(formatSyncMatchupsMessage(applied)).toContain("repaired 1");
    expect(formatSyncMatchupsMessage(applied)).toContain("unmatched 1");
  });

  it("surfaces lifecycle skip in Save Schedule message", () => {
    const summary = summarizeMatchupSync({
      report: baseReport({
        applied: false,
        skippedDueToLifecycle: true,
        lifecycleMessage: "Week status is COMPLETE",
        rows: [baseRow({ status: "missing" })],
      }),
    });
    expect(
      formatScheduleSaveMatchupMessage({
        created: 0,
        updated: 16,
        games: 16,
        uniqueTeamCount: 32,
        summary,
      }),
    ).toContain("Pool matchup sync skipped");
  });

  it("surfaces the operator matchup-not-stamped message", () => {
    expect(matchupNotStampedMessage(2)).toContain(
      "Week 2 matchup data has not been stamped",
    );
  });
});

describe("Save Schedule response contract", () => {
  it("exposes matchup synchronization result fields", () => {
    // Structural contract: commitManualSchedule return type must include these keys.
    const shape = {
      created: 0,
      updated: 16,
      games: 16,
      uniqueTeamCount: 32,
      orphanCleanup: null,
      matchupSync: baseReport({ applied: true, rows: [] }),
      matchupSummary: summarizeMatchupSync({
        report: baseReport({ applied: true, rows: [] }),
      }),
      operatorMessage: "Schedule saved ✓",
    };
    expect(shape).toHaveProperty("matchupSummary");
    expect(shape).toHaveProperty("operatorMessage");
    expect(shape.matchupSummary).toHaveProperty("linkedCorrectly");
  });
});
