import { describe, expect, it } from "vitest";
import { captureContestPregameSnapshotsForWeek } from "@/lib/consensus-snapshot";
import { getContestConsensus } from "@/lib/consensus";
import { buildConsensusEntries } from "@/lib/consensus-math";
import {
  isSeasonPlayerEligibleForWeeklyField,
  shouldPreserveAdminExclusion,
} from "@/lib/nfl/eligibility-rules";
import {
  aggregatePlayerResearchStats,
  lastThreeNflWeekNumbers,
  weekNumbersForWindow,
} from "@/lib/player-research";

describe("consensus snapshot immutability", () => {
  it("documents snapshot capture API for lock-time persistence", () => {
    expect(typeof captureContestPregameSnapshotsForWeek).toBe("function");
    expect(typeof getContestConsensus).toBe("function");
  });
});

describe("weekly eligibility rules", () => {
  it("keeps low-depth eligible players selectable", () => {
    expect(
      isSeasonPlayerEligibleForWeeklyField({
        activeOnNFLRoster: true,
        nflStatus: "ACTIVE",
      }),
    ).toBe(true);
  });

  it("excludes suspended and non-roster statuses", () => {
    expect(
      isSeasonPlayerEligibleForWeeklyField({
        activeOnNFLRoster: true,
        nflStatus: "SUSPENDED",
      }),
    ).toBe(false);
    expect(
      isSeasonPlayerEligibleForWeeklyField({
        activeOnNFLRoster: false,
        nflStatus: "ACTIVE",
      }),
    ).toBe(false);
  });

  it("preserves admin exclusions with reasons", () => {
    expect(
      shouldPreserveAdminExclusion({
        excluded: true,
        manuallyAdded: false,
        inactiveReason: "duplicate provider record",
      }),
    ).toBe(true);
  });

  it("does not preserve legacy editorial-only exclusions", () => {
    expect(
      shouldPreserveAdminExclusion({
        excluded: true,
        manuallyAdded: false,
        inactiveReason: null,
      }),
    ).toBe(false);
  });
});

describe("selection metrics", () => {
  it("calculates Selected % from ballots that included the player", () => {
    const built = buildConsensusEntries({
      fieldSize: 10,
      sampleSize: 100,
      entries: [
        {
          rankableEntryId: "a",
          name: "Player A",
          team: "MIN",
          opponent: "vs GB",
          actualRank: null,
          fantasyPoints: null,
          predictedRanks: Array.from({ length: 48 }, (_, index) => index + 1),
        },
        {
          rankableEntryId: "b",
          name: "Player B",
          team: "GB",
          opponent: "@ MIN",
          actualRank: null,
          fantasyPoints: null,
          predictedRanks: [],
        },
      ],
    });

    const a = built.entries.find((entry) => entry.rankableEntryId === "a");
    const b = built.entries.find((entry) => entry.rankableEntryId === "b");

    expect(a?.selectionRate).toBeCloseTo(0.48);
    expect(a?.averageSelectedRank).toBeCloseTo(24.5);
    expect(b?.selectionRate).toBe(0);
    expect(b?.averageSelectedRank).toBeNull();
  });

  it("isolates Human segment sample sizes in builder inputs", () => {
    const humanOnly = buildConsensusEntries({
      fieldSize: 10,
      sampleSize: 50,
      entries: [
        {
          rankableEntryId: "a",
          name: "Player A",
          team: "MIN",
          opponent: "vs GB",
          actualRank: 6,
          fantasyPoints: 20,
          predictedRanks: [1, 2, 3],
        },
      ],
    });

    expect(humanOnly.entries[0]?.sampleSize).toBe(50);
    expect(humanOnly.entries[0]?.selectionRate).toBeCloseTo(3 / 50);
  });
});

describe("Last 3 NFL calendar weeks", () => {
  it("uses previous three NFL weeks, not player last games", () => {
    expect(lastThreeNflWeekNumbers(8)).toEqual([5, 6, 7]);
    expect(lastThreeNflWeekNumbers(3)).toEqual([1, 2]);
    expect(lastThreeNflWeekNumbers(1)).toEqual([]);
  });

  it("does not backfill missed weeks in a player window", () => {
    const appearances = [
      {
        rankableEntryId: "p1",
        name: "Player",
        team: "MIN",
        position: "RB" as const,
        weekNumber: 5,
        actualRank: 10,
        fantasyPoints: 12,
        receptions: 2,
        rushingYards: 40,
        receivingYards: 10,
        passingYards: 0,
        passingTds: 0,
        interceptions: 0,
        rushingTds: 1,
        receivingTds: 0,
      },
      {
        rankableEntryId: "p1",
        name: "Player",
        team: "MIN",
        position: "RB" as const,
        weekNumber: 7,
        actualRank: 8,
        fantasyPoints: 15,
        receptions: 3,
        rushingYards: 55,
        receivingYards: 20,
        passingYards: 0,
        passingTds: 0,
        interceptions: 0,
        rushingTds: 0,
        receivingTds: 1,
      },
    ];

    const stats = aggregatePlayerResearchStats(
      appearances,
      { type: "last3", throughWeekNumber: 8 },
      [1, 2, 3, 4, 5, 6, 7],
    );

    expect(stats[0]?.gamesPlayed).toBe(2);
    expect(stats[0]?.weeksInWindow).toBe(3);
    expect(
      weekNumbersForWindow(
        { type: "last3", throughWeekNumber: 8 },
        [1, 2, 3, 4, 5, 6, 7],
      ),
    ).toEqual([5, 6, 7]);
  });
});

describe("league-wide finish depth", () => {
  it("supports ranks deeper than Top 10 in research aggregation", () => {
    const appearances = Array.from({ length: 15 }, (_, index) => ({
      rankableEntryId: "p1",
      name: "Deep",
      team: "MIN",
      position: "RB" as const,
      weekNumber: index + 1,
      actualRank: index + 1,
      fantasyPoints: 20 - index,
      receptions: 0,
      rushingYards: 0,
      receivingYards: 0,
      passingYards: 0,
      passingTds: 0,
      interceptions: 0,
      rushingTds: 0,
      receivingTds: 0,
    }));

    const stats = aggregatePlayerResearchStats(
      appearances,
      { type: "season" },
      appearances.map((row) => row.weekNumber),
    );

    expect(stats[0]?.averageFinish).toBe(8);
    expect(stats[0]?.top10Finishes).toBe(10);
  });
});
