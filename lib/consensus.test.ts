import { describe, expect, it } from "vitest";
import { filterEligibleConsensusSubmissions } from "@/lib/consensus-filters";
import { buildConsensusEntries } from "@/lib/consensus-math";
import { assignCompetitionRanksAscending } from "@/lib/fantasy/competition-rank";
import { ctaForContestState } from "@/lib/homepage-cta";

function ranks(count: number, rankValue: number) {
  return Array.from({ length: count }, () => rankValue);
}

function mixedRanks(spec: { rank: number; count: number }[]) {
  return spec.flatMap((item) => ranks(item.count, item.rank));
}

describe("buildConsensusEntries", () => {
  it("ranks by average predicted rank and excludes unranked from consensus order", () => {
    const { entries } = buildConsensusEntries({
      fieldSize: 10,
      sampleSize: 2,
      entries: [
        {
          rankableEntryId: "a",
          name: "A",
          team: "AAA",
          opponent: "@ BBB",
          actualRank: 2,
          fantasyPoints: 20,
          predictedRanks: [1, 2],
        },
        {
          rankableEntryId: "b",
          name: "B",
          team: "BBB",
          opponent: "vs AAA",
          actualRank: 1,
          fantasyPoints: 25,
          predictedRanks: [2, 1],
        },
        {
          rankableEntryId: "c",
          name: "C",
          team: "CCC",
          opponent: "@ DDD",
          actualRank: 15,
          fantasyPoints: 1,
          predictedRanks: [],
        },
      ],
    });

    expect(entries[0].name).toBe("A");
    expect(entries[0].consensusRank).toBe(1);
    expect(entries[0].averagePredictedRank).toBe(1.5);
    expect(entries[1].name).toBe("B");
    expect(entries[1].consensusRank).toBe(2);
    expect(entries.find((entry) => entry.name === "C")?.consensusRank).toBeNull();
  });

  it("computes Rank % / Podium % from sample size, not times ranked", () => {
    const { entries } = buildConsensusEntries({
      fieldSize: 10,
      sampleSize: 4,
      entries: [
        {
          rankableEntryId: "a",
          name: "A",
          team: "AAA",
          opponent: "@ BBB",
          actualRank: 1,
          fantasyPoints: 30,
          predictedRanks: [1, 1],
        },
      ],
    });

    expect(entries[0].rankPercent).toBe(0.5);
    expect(entries[0].podiumPercent).toBe(0.5);
    expect(entries[0].timesRanked).toBe(2);
    expect(entries[0].sampleSize).toBe(4);
  });

  it("assigns ordinal ranks for Rank %, Podium %, and Avg Rank", () => {
    const sampleSize = 100;
    const { entries } = buildConsensusEntries({
      fieldSize: 10,
      sampleSize,
      entries: [
        {
          rankableEntryId: "a",
          name: "Player A",
          team: "NYG",
          opponent: "@ DAL",
          actualRank: 7,
          fantasyPoints: 12,
          predictedRanks: [
            ...mixedRanks([
              { rank: 1, count: 5 },
              { rank: 2, count: 5 },
              { rank: 3, count: 5 },
              { rank: 4, count: 6 },
              { rank: 5, count: 52 },
            ]),
          ],
        },
        {
          rankableEntryId: "b",
          name: "Player B",
          team: "ATL",
          opponent: "vs CAR",
          actualRank: 1,
          fantasyPoints: 28,
          predictedRanks: [
            ...mixedRanks([
              { rank: 1, count: 10 },
              { rank: 2, count: 11 },
              { rank: 3, count: 10 },
              { rank: 4, count: 37 },
            ]),
          ],
        },
        {
          rankableEntryId: "c",
          name: "Player C",
          team: "TEN",
          opponent: "@ IND",
          actualRank: 11,
          fantasyPoints: 4,
          predictedRanks: [
            ...mixedRanks([
              { rank: 1, count: 3 },
              { rank: 3, count: 3 },
              { rank: 3, count: 3 },
              { rank: 8, count: 22 },
              { rank: 9, count: 12 },
            ]),
          ],
        },
      ],
    });

    const a = entries.find((entry) => entry.name === "Player A");
    const b = entries.find((entry) => entry.name === "Player B");
    const c = entries.find((entry) => entry.name === "Player C");

    expect(a?.rankPercentRank).toBe(1);
    expect(b?.rankPercentRank).toBe(2);
    expect(c?.rankPercentRank).toBe(3);

    expect(b?.podiumPercentRank).toBe(1);
    expect(a?.podiumPercentRank).toBe(2);
    expect(c?.podiumPercentRank).toBe(3);

    expect(b?.averageRankRank).toBe(1);
    expect(a?.averageRankRank).toBe(2);
    expect(c?.averageRankRank).toBe(3);

    expect(Math.round((a?.rankPercent ?? 0) * 100)).toBe(73);
    expect(Math.round((b?.rankPercent ?? 0) * 100)).toBe(68);
    expect(Math.round((c?.rankPercent ?? 0) * 100)).toBe(43);
    expect(Math.round((a?.podiumPercent ?? 0) * 100)).toBe(15);
    expect(Math.round((b?.podiumPercent ?? 0) * 100)).toBe(31);
    expect(Math.round((c?.podiumPercent ?? 0) * 100)).toBe(9);
    expect(a?.averagePredictedRank).toBeCloseTo(4.3, 1);
    expect(b?.averagePredictedRank).toBeCloseTo(3.1, 1);
    expect(c?.averagePredictedRank).toBeCloseTo(7.1, 1);
  });

  it("uses competition ranking for tied Rank % values", () => {
    const { entries } = buildConsensusEntries({
      fieldSize: 10,
      sampleSize: 10,
      entries: [
        {
          rankableEntryId: "t1",
          name: "Tie One",
          team: "T1",
          opponent: "@ X",
          actualRank: null,
          fantasyPoints: null,
          predictedRanks: [1, 2, 3, 4, 5],
        },
        {
          rankableEntryId: "t2",
          name: "Tie Two",
          team: "T2",
          opponent: "@ Y",
          actualRank: null,
          fantasyPoints: null,
          predictedRanks: [1, 2, 3, 4, 5],
        },
        {
          rankableEntryId: "solo",
          name: "Solo",
          team: "S",
          opponent: "@ Z",
          actualRank: null,
          fantasyPoints: null,
          predictedRanks: [1, 2],
        },
      ],
    });

    const tieOne = entries.find((entry) => entry.name === "Tie One");
    const tieTwo = entries.find((entry) => entry.name === "Tie Two");
    const solo = entries.find((entry) => entry.name === "Solo");

    expect(tieOne?.rankPercentRank).toBe(1);
    expect(tieTwo?.rankPercentRank).toBe(1);
    expect(solo?.rankPercentRank).toBe(3);
  });

  it("excludes zero-sample players from Average Rank ordinal rank", () => {
    const { entries } = buildConsensusEntries({
      fieldSize: 10,
      sampleSize: 5,
      entries: [
        {
          rankableEntryId: "picked",
          name: "Picked",
          team: "P",
          opponent: "@ X",
          actualRank: null,
          fantasyPoints: null,
          predictedRanks: [4, 5],
        },
        {
          rankableEntryId: "never",
          name: "Never",
          team: "N",
          opponent: "@ Y",
          actualRank: null,
          fantasyPoints: null,
          predictedRanks: [],
        },
      ],
    });

    const picked = entries.find((entry) => entry.name === "Picked");
    const never = entries.find((entry) => entry.name === "Never");

    expect(picked?.averageRankRank).toBe(1);
    expect(never?.averageRankRank).toBeNull();
    expect(never?.rankPercentRank).not.toBeNull();
  });

  it("recalculates ordinal ranks independently per filter sample", () => {
    const poolEntry = {
      rankableEntryId: "star",
      name: "Star",
      team: "ST",
      opponent: "@ X",
      actualRank: null as number | null,
      fantasyPoints: null as number | null,
    };

    const community = buildConsensusEntries({
      fieldSize: 10,
      sampleSize: 10,
      entries: [
        {
          ...poolEntry,
          predictedRanks: [1, 1, 1, 1, 1, 1, 1, 1, 2, 2],
        },
        {
          rankableEntryId: "other",
          name: "Other",
          team: "OT",
          opponent: "@ Y",
          actualRank: null,
          fantasyPoints: null,
          predictedRanks: [3, 4, 5],
        },
      ],
    });

    const experts = buildConsensusEntries({
      fieldSize: 10,
      sampleSize: 2,
      entries: [
        {
          ...poolEntry,
          predictedRanks: [2],
        },
        {
          rankableEntryId: "other",
          name: "Other",
          team: "OT",
          opponent: "@ Y",
          actualRank: null,
          fantasyPoints: null,
          predictedRanks: [1, 1],
        },
      ],
    });

    const ai = buildConsensusEntries({
      fieldSize: 10,
      sampleSize: 1,
      entries: [
        {
          ...poolEntry,
          predictedRanks: [1],
        },
        {
          rankableEntryId: "other",
          name: "Other",
          team: "OT",
          opponent: "@ Y",
          actualRank: null,
          fantasyPoints: null,
          predictedRanks: [],
        },
      ],
    });

    expect(community.entries.find((e) => e.name === "Star")?.rankPercentRank).toBe(
      1,
    );
    expect(experts.entries.find((e) => e.name === "Other")?.rankPercentRank).toBe(
      1,
    );
    expect(ai.entries.find((e) => e.name === "Star")?.rankPercentRank).toBe(1);
    expect(ai.entries.find((e) => e.name === "Star")?.sampleSize).toBe(1);
  });

  it("marks actual results final only when requested", () => {
    const open = buildConsensusEntries({
      fieldSize: 10,
      sampleSize: 1,
      actualResultFinal: false,
      entries: [
        {
          rankableEntryId: "a",
          name: "A",
          team: "A",
          opponent: "@ B",
          actualRank: 3,
          fantasyPoints: 10,
          predictedRanks: [2],
        },
      ],
    });
    const final = buildConsensusEntries({
      fieldSize: 10,
      sampleSize: 1,
      actualResultFinal: true,
      entries: [
        {
          rankableEntryId: "a",
          name: "A",
          team: "A",
          opponent: "@ B",
          actualRank: 3,
          fantasyPoints: 10,
          predictedRanks: [2],
        },
      ],
    });

    expect(open.entries[0].actualResultFinal).toBe(false);
    expect(final.entries[0].actualResultFinal).toBe(true);
    expect(final.entries[0].actualRank).toBe(3);
    expect(final.entries[0].fantasyPoints).toBe(10);
  });

  it("identifies hit/miss/polarizing callouts when actuals exist", () => {
    const { callouts } = buildConsensusEntries({
      fieldSize: 10,
      sampleSize: 3,
      actualResultFinal: true,
      entries: [
        {
          rankableEntryId: "hit",
          name: "Hit",
          team: "HIT",
          opponent: "@ X",
          actualRank: 1,
          fantasyPoints: 30,
          predictedRanks: [1, 1, 2],
        },
        {
          rankableEntryId: "miss",
          name: "Miss",
          team: "MSS",
          opponent: "@ Y",
          actualRank: 10,
          fantasyPoints: 5,
          predictedRanks: [1, 2, 1],
        },
        {
          rankableEntryId: "polar",
          name: "Polar",
          team: "POL",
          opponent: "@ Z",
          actualRank: 5,
          fantasyPoints: 12,
          predictedRanks: [1, 10, 2],
        },
      ],
    });

    expect(callouts.biggestHit?.name).toBe("Hit");
    expect(callouts.biggestMiss?.name).toBe("Miss");
    expect(callouts.mostPolarizing?.name).toBe("Polar");
  });
});

describe("assignCompetitionRanksAscending", () => {
  it("ranks lower values better with competition ties", () => {
    const ranked = assignCompetitionRanksAscending(
      [
        { id: "a", value: 4.3 },
        { id: "b", value: 3.1 },
        { id: "c", value: 3.1 },
        { id: "d", value: 7.1 },
      ],
      (row) => row.value,
    );

    expect(ranked.find((row) => row.item.id === "b")?.rank).toBe(1);
    expect(ranked.find((row) => row.item.id === "c")?.rank).toBe(1);
    expect(ranked.find((row) => row.item.id === "a")?.rank).toBe(3);
    expect(ranked.find((row) => row.item.id === "d")?.rank).toBe(4);
  });
});

describe("ctaForContestState", () => {
  it("returns state-appropriate CTAs", () => {
    expect(ctaForContestState("OPEN", null)).toBe("Build Rankings");
    expect(ctaForContestState("OPEN", "DRAFT")).toBe("Edit Rankings");
    expect(ctaForContestState("OPEN", "SUBMITTED")).toBe("Edit Rankings");
    expect(ctaForContestState("LOCKED", "SUBMITTED")).toBe(
      "View Locked Rankings",
    );
    expect(ctaForContestState("FINAL", null)).toBe("View Results");
  });
});

describe("filterEligibleConsensusSubmissions", () => {
  const ballots = [
    { id: "d", status: "DRAFT" as const, profileType: "HUMAN" as const },
    { id: "h", status: "SUBMITTED" as const, profileType: "HUMAN" as const },
    { id: "a", status: "LOCKED" as const, profileType: "AI" as const },
    { id: "g", status: "GRADED" as const, profileType: "HUMAN" as const },
    { id: "b", status: "LOCKED" as const, profileType: "BENCHMARK" as const },
  ];

  it("excludes drafts from consensus sample", () => {
    const eligible = filterEligibleConsensusSubmissions(ballots, "ALL");
    expect(eligible.map((row) => row.id)).toEqual(["h", "a", "g"]);
    expect(eligible.some((row) => row.id === "b")).toBe(false);
  });

  it("filters Human and AI official ballots", () => {
    expect(
      filterEligibleConsensusSubmissions(ballots, "HUMAN").map((row) => row.id),
    ).toEqual(["h", "g"]);
    expect(
      filterEligibleConsensusSubmissions(ballots, "AI").map((row) => row.id),
    ).toEqual(["a"]);
    expect(
      filterEligibleConsensusSubmissions(ballots, "EXPERT").map((row) => row.id),
    ).toEqual(["b"]);
  });
});

describe("homepage empty CTA states", () => {
  it("uses Build Rankings when open with no submission", () => {
    expect(ctaForContestState("OPEN", null)).toBe("Build Rankings");
  });

  it("uses View Results for finalized contests", () => {
    expect(ctaForContestState("FINAL", "GRADED")).toBe("View Results");
    expect(ctaForContestState("ARCHIVED", null)).toBe("View Results");
  });
});
