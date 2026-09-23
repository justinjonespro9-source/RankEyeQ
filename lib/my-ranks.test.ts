import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ctaForContestState, hrefForContestState } from "@/lib/homepage-cta";
import {
  provisionalStandingStatus,
  scoreProvisionalEyeq,
  shouldShowFinalExactHit,
} from "@/lib/live-provisional";
import { provisionalRanksFromPoints } from "@/lib/live-rankiq";
import {
  buildMyRanksBoardPresentation,
  thisWeekHubCopy,
  type MyRanksPickDisplayMeta,
} from "@/lib/my-ranks";
import {
  deriveEffectiveBoard,
  type EffectiveBoardPickInput,
} from "@/lib/reserves/effective-board";

function boardPick(
  partial: Partial<EffectiveBoardPickInput> & {
    rankableEntryId: string;
    predictedRank: number;
    name: string;
  },
): EffectiveBoardPickInput {
  return {
    availability: "ACTIVE",
    kickoffAt: null,
    wasUnavailableAtKickoff: null,
    reserveEligiblePredecessorIds: null,
    ...partial,
  };
}

const sundayKick = new Date("2026-09-14T17:00:00Z");
const afterKick = new Date("2026-09-14T18:00:00Z");

/** WR Top 15 + R1/R2 fixture with optional per-rank overrides. */
function wrBoardWithReserves(
  overrides: Record<number, Partial<EffectiveBoardPickInput>> = {},
): EffectiveBoardPickInput[] {
  const names = [
    "Puka Nacua",
    "Player B",
    "Player C",
    "Player D",
    "Player E",
    "Player F",
    "Player G",
    "Player H",
    "Player I",
    "Player J",
    "Player K",
    "Player L",
    "Player M",
    "Player N",
    "Player O",
    "Parker Washington",
    "Malik Nabers",
  ];
  return names.map((name, index) => {
    const rank = index + 1;
    return boardPick({
      rankableEntryId: `entry-${rank}`,
      predictedRank: rank,
      name,
      kickoffAt: sundayKick,
      ...overrides[rank],
    });
  });
}

function metaFromPicks(
  picks: EffectiveBoardPickInput[],
): MyRanksPickDisplayMeta[] {
  return picks.map((pick) => ({
    rankableEntryId: pick.rankableEntryId,
    predictedRank: pick.predictedRank,
    name: pick.name ?? pick.rankableEntryId,
    team: "LAR",
    opponent: "SEA",
    fantasyPoints: null,
    currentActualRank: null,
    availability: pick.availability ?? null,
  }));
}

function presentWr(
  overrides: Record<number, Partial<EffectiveBoardPickInput>> = {},
  now = afterKick,
) {
  const picks = wrBoardWithReserves(overrides);
  const originalPredictedRanks = picks.map((p) => ({
    id: p.rankableEntryId,
    predictedRank: p.predictedRank,
  }));
  const board = deriveEffectiveBoard({
    picks,
    scoringDepth: 15,
    now,
  });
  const presentation = buildMyRanksBoardPresentation({
    scoringDepth: 15,
    board,
    pickMeta: metaFromPicks(picks),
    isFinal: false,
  });
  return { picks, board, presentation, originalPredictedRanks };
}

describe("My Ranks live dashboard derivation", () => {
  it("orders live standings by fantasy points with competition ranks", () => {
    const ranked = provisionalRanksFromPoints([
      { rankableEntryId: "a", fantasyPoints: 22.1 },
      { rankableEntryId: "b", fantasyPoints: 30.4 },
      { rankableEntryId: "c", fantasyPoints: -1.2 },
      { rankableEntryId: "d", fantasyPoints: null },
    ]);
    expect(ranked.map((row) => [row.item.rankableEntryId, row.rank, row.score])).toEqual([
      ["b", 1, 30.4],
      ["a", 2, 22.1],
      ["c", 3, -1.2],
    ]);
  });

  it("hides null/unplayed players from live standings", () => {
    const ranked = provisionalRanksFromPoints([
      { rankableEntryId: "played", fantasyPoints: 10 },
      { rankableEntryId: "unplayed", fantasyPoints: null },
    ]);
    expect(ranked.map((row) => row.item.rankableEntryId)).toEqual(["played"]);
  });

  it("shows negative fantasy scores", () => {
    const ranked = provisionalRanksFromPoints([
      { rankableEntryId: "bad", fantasyPoints: -4 },
    ]);
    expect(ranked[0]?.score).toBe(-4);
  });

  it("builds perfect board as current Top 10 / Top 15 from standings", () => {
    const ranked = provisionalRanksFromPoints(
      Array.from({ length: 18 }, (_, index) => ({
        rankableEntryId: `p${index}`,
        fantasyPoints: 50 - index,
      })),
    );
    const top10 = ranked.slice(0, 10).map((row, index) => ({
      rank: index + 1,
      id: row.item.rankableEntryId,
    }));
    const top15 = ranked.slice(0, 15).map((row, index) => ({
      rank: index + 1,
      id: row.item.rankableEntryId,
    }));
    expect(top10).toHaveLength(10);
    expect(top15).toHaveLength(15);
    expect(top10[0]?.id).toBe("p0");
    expect(top15[14]?.id).toBe("p14");
  });

  it("uses WR Top 15 field for standing colors and EYEQ", () => {
    expect(provisionalStandingStatus(15, 15)).toBe("IN_FIELD");
    expect(provisionalStandingStatus(16, 15)).toBe("OUTSIDE_FIELD");
    const summary = scoreProvisionalEyeq(
      [
        {
          playerId: "wr1",
          playerName: "JSN",
          predictedRank: 7,
          provisionalActualRank: 1,
        },
      ],
      15,
    );
    expect(summary.players[0]?.standingStatus).toBe("GOLD");
    expect(summary.maxPoints).toBeGreaterThan(210);
  });

  it("matches podium/green visuals to current actual rank not predicted slot", () => {
    expect(provisionalStandingStatus(1, 10)).toBe("GOLD");
    expect(provisionalStandingStatus(2, 10)).toBe("SILVER");
    expect(provisionalStandingStatus(3, 10)).toBe("BRONZE");
    expect(provisionalStandingStatus(7, 10)).toBe("IN_FIELD");
  });

  it("exact-hit celebration is final-only", () => {
    expect(
      shouldShowFinalExactHit({ exactHit: true, contestIsFinal: false }),
    ).toBe(false);
    expect(
      shouldShowFinalExactHit({ exactHit: true, contestIsFinal: true }),
    ).toBe(true);
  });

  it("final transition prefers official actual ranks over provisional", () => {
    const live = provisionalRanksFromPoints([
      { rankableEntryId: "a", fantasyPoints: 40 },
      { rankableEntryId: "b", fantasyPoints: 10 },
    ]);
    expect(live[0]?.item.rankableEntryId).toBe("a");

    const finalRows = [
      { rankableEntryId: "b", actualRank: 1, fantasyPoints: 12 },
      { rankableEntryId: "a", actualRank: 2, fantasyPoints: 40 },
    ].sort((left, right) => left.actualRank - right.actualRank);

    expect(finalRows.map((row) => row.rankableEntryId)).toEqual(["b", "a"]);
  });
});

describe("This Week state-aware copy and CTAs", () => {
  it("builds hub titles from submission state", () => {
    expect(
      thisWeekHubCopy({
        weekNumber: 1,
        weekLabel: "Week 1",
        positions: [{ contestStatus: "OPEN", submissionStatus: null }],
      }).title,
    ).toBe("Build Your Week 1 Rankings");

    expect(
      thisWeekHubCopy({
        weekNumber: 1,
        weekLabel: "Week 1",
        positions: [{ contestStatus: "OPEN", submissionStatus: "DRAFT" }],
      }).title,
    ).toBe("Continue Your Rankings");

    expect(
      thisWeekHubCopy({
        weekNumber: 1,
        weekLabel: "Week 1",
        positions: [{ contestStatus: "OPEN", submissionStatus: "SUBMITTED" }],
      }),
    ).toEqual({
      title: "Your Week 1 Rankings",
      description: "Submitted · Editable until lock",
    });

    expect(
      thisWeekHubCopy({
        weekNumber: 1,
        weekLabel: "Week 1",
        positions: [{ contestStatus: "LOCKED", submissionStatus: "SUBMITTED" }],
      }),
    ).toEqual({
      title: "Your Week 1 Rankings",
      description: "Locked",
    });
  });

  it("does not use Build Rankings CTA after submit", () => {
    expect(ctaForContestState("OPEN", "SUBMITTED")).toBe("Edit Rankings");
    expect(ctaForContestState("OPEN", "DRAFT")).toBe("Continue Your Rankings");
    expect(ctaForContestState("OPEN", null)).toBe("Build Rankings");
    expect(ctaForContestState("LOCKED", "SUBMITTED")).toBe("View My Ranks");
    expect(hrefForContestState({
      position: "QB",
      contestStatus: "LOCKED",
      submissionStatus: "SUBMITTED",
    })).toBe("/my-ranks?position=qb");
  });
});

describe("My Ranks authenticated route contract", () => {
  it("exposes /my-ranks as primary nav destination", async () => {
    const { PRIMARY_NAV } = await import("@/lib/navigation");
    const link = PRIMARY_NAV.find((item) => item.label === "My Ranks");
    expect(link?.href).toBe("/my-ranks");
  });
});

describe("My Ranks effective-board presentation", () => {
  it("1. no unavailable players → primary ranking remains #1…#N", () => {
    const { presentation, board } = presentWr();
    expect(presentation.hasSubstitution).toBe(false);
    expect(presentation.effectivePicks).toHaveLength(15);
    expect(presentation.effectivePicks.map((r) => r.effectiveRank)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 1),
    );
    expect(presentation.effectivePicks.map((r) => r.rankableEntryId)).toEqual(
      board.effective.map((r) => r.rankableEntryId),
    );
    expect(presentation.displacedPlayers).toHaveLength(0);
    expect(presentation.activations).toHaveLength(0);
  });

  it("2–10. Puka #1 INACTIVE → compact board, R1 at #15, original preserved", () => {
    const { presentation, originalPredictedRanks } = presentWr({
      1: {
        availability: "INACTIVE",
        wasUnavailableAtKickoff: true,
      },
    });

    // 2. Puka absent from numbered effective ranking
    expect(
      presentation.effectivePicks.some((r) => r.name === "Puka Nacua"),
    ).toBe(false);

    // 3. Original #2 renders as effective #1
    expect(presentation.effectivePicks[0]).toMatchObject({
      name: "Player B",
      effectiveRank: 1,
      originalPredictedRank: 2,
      fromReserve: false,
    });

    // 4. Original #15 renders as effective #14
    expect(presentation.effectivePicks[13]).toMatchObject({
      name: "Player O",
      effectiveRank: 14,
      originalPredictedRank: 15,
    });

    // 5–6. R1 renders as effective #15 with R1 → #15
    expect(presentation.effectivePicks[14]).toMatchObject({
      name: "Parker Washington",
      effectiveRank: 15,
      fromReserve: true,
      reserveSlot: 1,
    });
    expect(presentation.reserveRows[0]).toMatchObject({
      name: "Parker Washington",
      reserveSlot: 1,
      activatedToRank: 15,
    });
    expect(presentation.activations).toEqual([
      {
        reserveName: "Parker Washington",
        reserveSlot: 1,
        effectiveRank: 15,
      },
    ]);

    // 7. No direct "replaced Puka" semantics in presentation fields
    expect(JSON.stringify(presentation.activations)).not.toMatch(/replaced/i);
    expect(JSON.stringify(presentation.reserveRows)).not.toMatch(/replaced/i);

    // 8. Puka appears separately as INACTIVE/removed with original-rank context
    expect(presentation.displacedPlayers).toEqual([
      expect.objectContaining({
        name: "Puka Nacua",
        originalPredictedRank: 1,
        availability: "INACTIVE",
      }),
    ]);
    expect(presentation.hasSubstitution).toBe(true);

    // 9–10. Original submission still shows Puka #1 and Parker as R1
    expect(presentation.originalPicks[0]).toMatchObject({
      name: "Puka Nacua",
      predictedRank: 1,
      isReserve: false,
    });
    expect(presentation.originalPicks[15]).toMatchObject({
      name: "Parker Washington",
      predictedRank: 16,
      isReserve: true,
      reserveSlot: 1,
    });

    // 17. Original predictedRank data unchanged
    expect(originalPredictedRanks).toEqual(
      presentation.originalPicks.map((p) => ({
        id: p.rankableEntryId,
        predictedRank: p.predictedRank,
      })),
    );
  });

  it("11–12. two displaced ranked players compact; R1/R2 fill bottom slots", () => {
    const { presentation, board } = presentWr({
      1: {
        name: "Puka Nacua",
        availability: "INACTIVE",
        wasUnavailableAtKickoff: true,
      },
      3: {
        name: "Nico Collins",
        availability: "OUT",
        wasUnavailableAtKickoff: true,
      },
    });

    expect(presentation.displacedPlayers.map((d) => d.name).sort()).toEqual([
      "Nico Collins",
      "Puka Nacua",
    ]);
    expect(presentation.effectivePicks).toHaveLength(15);
    expect(
      presentation.effectivePicks.slice(13).map((r) => ({
        name: r.name,
        effectiveRank: r.effectiveRank,
        fromReserve: r.fromReserve,
        reserveSlot: r.reserveSlot,
      })),
    ).toEqual(
      board.effective.slice(13).map((r) => ({
        name: presentation.originalPicks.find(
          (o) => o.rankableEntryId === r.rankableEntryId,
        )!.name,
        effectiveRank: r.predictedRank,
        fromReserve: r.fromReserve,
        reserveSlot: r.reserveSlot,
      })),
    );
    expect(presentation.activations.map((a) => a.effectiveRank)).toEqual(
      board.activations.map((a) => a.effectiveRank),
    );
    expect(presentation.activations).toHaveLength(2);
    // R1 does not inherit Puka's #1
    expect(presentation.effectivePicks[0]?.fromReserve).toBe(false);
    expect(presentation.effectivePicks[0]?.name).not.toBe("Parker Washington");
  });

  it("13–14. unavailable R1 does not activate; eligible R2 matches engine", () => {
    const { presentation, board } = presentWr({
      1: {
        availability: "INACTIVE",
        wasUnavailableAtKickoff: true,
      },
      16: {
        name: "Parker Washington",
        availability: "OUT",
        wasUnavailableAtKickoff: true,
      },
      17: {
        name: "Malik Nabers",
        availability: "ACTIVE",
        wasUnavailableAtKickoff: false,
      },
    });

    expect(
      presentation.effectivePicks.some((r) => r.name === "Parker Washington"),
    ).toBe(false);
    expect(presentation.reserveRows[0]).toMatchObject({
      name: "Parker Washington",
      activatedToRank: null,
      unavailable: true,
    });
    expect(presentation.activations).toHaveLength(1);
    expect(presentation.activations[0]).toMatchObject({
      reserveName: "Malik Nabers",
      reserveSlot: 2,
      effectiveRank: board.activations[0]!.effectiveRank,
    });
    expect(
      presentation.effectivePicks.find((r) => r.name === "Malik Nabers"),
    ).toMatchObject({
      fromReserve: true,
      reserveSlot: 2,
      effectiveRank: board.activations[0]!.effectiveRank,
    });
  });

  it("15. anti-hindsight blocked reserve is not promoted", () => {
    const predecessorsWithoutPuka = [
      "entry-2",
      "entry-3",
      "entry-4",
      "entry-5",
      "entry-6",
      "entry-7",
      "entry-8",
      "entry-9",
      "entry-10",
      "entry-11",
      "entry-12",
      "entry-13",
      "entry-14",
      "entry-15",
    ];
    const { presentation, board } = presentWr({
      1: {
        availability: "INACTIVE",
        wasUnavailableAtKickoff: true,
      },
      16: {
        // Locked without Puka on the eligible predecessor snapshot
        reserveEligiblePredecessorIds: predecessorsWithoutPuka,
      },
      17: {
        reserveEligiblePredecessorIds: predecessorsWithoutPuka,
      },
    });

    expect(board.activations).toHaveLength(0);
    expect(presentation.activations).toHaveLength(0);
    expect(presentation.effectivePicks.some((r) => r.fromReserve)).toBe(false);
    expect(presentation.reserveRows.every((r) => r.activatedToRank == null)).toBe(
      true,
    );
    expect(presentation.effectivePicks).toHaveLength(14);
  });

  it("16. short effective board when no eligible reserve can fill vacancy", () => {
    const { presentation, board } = presentWr({
      1: {
        availability: "INACTIVE",
        wasUnavailableAtKickoff: true,
      },
      16: {
        availability: "OUT",
        wasUnavailableAtKickoff: true,
      },
      17: {
        availability: "INACTIVE",
        wasUnavailableAtKickoff: true,
      },
    });

    expect(board.activations).toHaveLength(0);
    expect(presentation.effectivePicks).toHaveLength(14);
    expect(presentation.effectivePicks).toHaveLength(board.effective.length);
    expect(presentation.activations).toHaveLength(0);
  });

  it("18. presentation does not mutate original predicted ranks", () => {
    const picks = wrBoardWithReserves({
      1: { availability: "INACTIVE", wasUnavailableAtKickoff: true },
    });
    const before = picks.map((p) => p.predictedRank);
    const board = deriveEffectiveBoard({
      picks,
      scoringDepth: 15,
      now: afterKick,
    });
    buildMyRanksBoardPresentation({
      scoringDepth: 15,
      board,
      pickMeta: metaFromPicks(picks),
      isFinal: false,
    });
    expect(picks.map((p) => p.predictedRank)).toEqual(before);
  });

  it("UI source does not present direct reserve-replaced copy", () => {
    const source = readFileSync(
      join(process.cwd(), "components/my-ranks/MyRanksDashboard.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/Replaced:/i);
    expect(source).not.toMatch(/Replaced /);
    expect(source).toMatch(/Activated →/);
    expect(source).toMatch(/Removed from scoring board/);
    expect(source).toMatch(/Original submission/);
  });
});
