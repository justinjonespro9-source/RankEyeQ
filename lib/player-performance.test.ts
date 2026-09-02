import { describe, expect, it } from "vitest";
import {
  aggregatePlayerPerformance,
  mapContestEntriesToPerformanceSource,
  type PlayerPerformanceSourceRow,
} from "@/lib/player-performance";

function sourceRow(
  overrides: Partial<PlayerPerformanceSourceRow> & {
    rankableEntryId: string;
    name: string;
    actualRank: number | null;
    wasActive: boolean;
  },
): PlayerPerformanceSourceRow {
  return {
    team: "MIN",
    position: "RB",
    weekId: "w1",
    weekLabel: "Week 1",
    weekNumber: 1,
    contestId: "c1",
    weekTeam: "MIN",
    fantasyPoints: 10,
    contestFinal: true,
    consensusRank: null,
    ...overrides,
  };
}

describe("aggregatePlayerPerformance", () => {
  const rows: PlayerPerformanceSourceRow[] = [
    sourceRow({
      rankableEntryId: "jones",
      name: "Aaron Jones Sr.",
      actualRank: 7,
      wasActive: true,
      weekNumber: 1,
      weekId: "w1",
    }),
    sourceRow({
      rankableEntryId: "jones",
      name: "Aaron Jones Sr.",
      actualRank: 3,
      wasActive: true,
      weekNumber: 2,
      weekId: "w2",
      weekLabel: "Week 2",
      contestId: "c2",
    }),
    sourceRow({
      rankableEntryId: "jones",
      name: "Aaron Jones Sr.",
      actualRank: null,
      wasActive: false,
      weekNumber: 3,
      weekId: "w3",
      weekLabel: "Week 3",
    }),
    sourceRow({
      rankableEntryId: "claire",
      name: "Demond Claiborne",
      actualRank: null,
      wasActive: false,
      weekNumber: 1,
      weekId: "w1",
    }),
    sourceRow({
      rankableEntryId: "mason",
      name: "Jordan Mason",
      actualRank: 1,
      wasActive: true,
      weekNumber: 1,
      weekId: "w1",
    }),
    sourceRow({
      rankableEntryId: "mason",
      name: "Jordan Mason",
      actualRank: 12,
      wasActive: true,
      weekNumber: 2,
      weekId: "w2",
      weekLabel: "Week 2",
      contestId: "c2",
    }),
  ];

  it("excludes inactive weeks from average finish", () => {
    const [jones] = aggregatePlayerPerformance(rows, {
      position: "RB",
      qualification: "ALL",
    }).filter((row) => row.name.includes("Aaron"));

    expect(jones.weeksEligible).toBe(2);
    expect(jones.weeksRecorded).toBe(2);
    expect(jones.averageFinish).toBe(5);
    expect(jones.appearances).toHaveLength(2);
  });

  it("does not create performance row for players with zero recorded weeks under qualification", () => {
    const claire = aggregatePlayerPerformance(rows, {
      position: "RB",
      qualification: "MIN_4",
    }).find((row) => row.name.includes("Claiborne"));

    expect(claire).toBeUndefined();
  });

  it("calculates top finishes and best/worst correctly", () => {
    const mason = aggregatePlayerPerformance(rows, {
      position: "RB",
      qualification: "ALL",
    }).find((row) => row.name.includes("Mason"));

    expect(mason?.top3Finishes).toBe(1);
    expect(mason?.top5Finishes).toBe(1);
    expect(mason?.top10Finishes).toBe(1);
    expect(mason?.numberOneFinishes).toBe(1);
    expect(mason?.bestFinish).toBe(1);
    expect(mason?.worstFinish).toBe(12);
  });

  it("sorts by average finish ascending by default", () => {
    const leaderboard = aggregatePlayerPerformance(rows, {
      position: "RB",
      qualification: "ALL",
      sort: "averageFinish",
      sortDirection: "asc",
    });

    expect(leaderboard[0].name).toContain("Aaron");
    expect(leaderboard[1].name).toContain("Mason");
  });

  it("filters by position independently for DEF", () => {
    const defRows: PlayerPerformanceSourceRow[] = [
      sourceRow({
        rankableEntryId: "min-def",
        name: "MIN",
        position: "DEF",
        actualRank: 4,
        wasActive: true,
      }),
    ];

    const offensive = aggregatePlayerPerformance([...rows, ...defRows], {
      position: "QB",
      qualification: "ALL",
    });
    expect(offensive).toHaveLength(0);

    const defenses = aggregatePlayerPerformance([...rows, ...defRows], {
      position: "DEF",
      qualification: "ALL",
    });
    expect(defenses).toHaveLength(1);
    expect(defenses[0].position).toBe("DEF");
  });
});

describe("mapContestEntriesToPerformanceSource", () => {
  it("marks inactive contest entries as non-scoring weeks", () => {
    const mapped = mapContestEntriesToPerformanceSource([
      {
        rankableEntryId: "p1",
        name: "Player",
        team: "MIN",
        position: "RB",
        weekId: "w1",
        weekLabel: "Week 1",
        weekNumber: 1,
        contestId: "c1",
        weekTeam: "MIN",
        actualRank: 99,
        fantasyPoints: 0,
        excluded: true,
        contestStatus: "FINAL",
      },
    ]);

    expect(mapped[0].wasActive).toBe(false);
  });
});
