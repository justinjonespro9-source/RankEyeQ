import { describe, expect, it } from "vitest";
import {
  deriveEffectiveBoard,
  isDisplacedFromScoringBoard,
  snapshotReservePredecessors,
  type EffectiveBoardPickInput,
} from "@/lib/reserves/effective-board";

function pick(
  partial: Partial<EffectiveBoardPickInput> & {
    rankableEntryId: string;
    predictedRank: number;
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

const sunday = new Date("2026-09-14T17:00:00Z");
const thursdayKick = new Date("2026-09-11T00:20:00Z");
const fridayNoon = new Date("2026-09-12T17:00:00Z");
const sundayKick = new Date("2026-09-14T17:00:00Z");

function top10WithReserves(
  overrides: Record<number, Partial<EffectiveBoardPickInput>> = {},
): EffectiveBoardPickInput[] {
  return Array.from({ length: 12 }, (_, i) => {
    const rank = i + 1;
    return pick({
      rankableEntryId: `p${rank}`,
      predictedRank: rank,
      name: `Player ${rank}`,
      kickoffAt: sundayKick,
      ...overrides[rank],
    });
  });
}

describe("isDisplacedFromScoringBoard", () => {
  it("promotes on OUT before kickoff", () => {
    expect(
      isDisplacedFromScoringBoard({
        availability: "OUT",
        kickoffAt: sundayKick,
        wasUnavailableAtKickoff: null,
        now: fridayNoon,
      }),
    ).toBe(true);
  });

  it("does not promote on QUESTIONABLE or DOUBTFUL", () => {
    expect(
      isDisplacedFromScoringBoard({
        availability: "QUESTIONABLE",
        kickoffAt: sundayKick,
        now: fridayNoon,
      }),
    ).toBe(false);
    expect(
      isDisplacedFromScoringBoard({
        availability: "DOUBTFUL",
        kickoffAt: sundayKick,
        now: fridayNoon,
      }),
    ).toBe(false);
  });

  it("after kickoff uses frozen flag only", () => {
    expect(
      isDisplacedFromScoringBoard({
        availability: "OUT",
        kickoffAt: thursdayKick,
        wasUnavailableAtKickoff: false,
        now: fridayNoon,
      }),
    ).toBe(false);
    expect(
      isDisplacedFromScoringBoard({
        availability: "ACTIVE",
        kickoffAt: thursdayKick,
        wasUnavailableAtKickoff: true,
        now: fridayNoon,
      }),
    ).toBe(true);
  });
});

describe("deriveEffectiveBoard basic", () => {
  it("Top10 + 2 reserves with no OUT keeps original top 10", () => {
    const board = deriveEffectiveBoard({
      picks: top10WithReserves(),
      scoringDepth: 10,
      now: fridayNoon,
    });
    expect(board.effective).toHaveLength(10);
    expect(board.effective.map((r) => r.rankableEntryId)).toEqual(
      Array.from({ length: 10 }, (_, i) => `p${i + 1}`),
    );
    expect(board.activations).toHaveLength(0);
  });

  it("WR Top15 + 2 reserves", () => {
    const picks = Array.from({ length: 17 }, (_, i) =>
      pick({
        rankableEntryId: `w${i + 1}`,
        predictedRank: i + 1,
        kickoffAt: sundayKick,
      }),
    );
    const board = deriveEffectiveBoard({
      picks,
      scoringDepth: 15,
      now: fridayNoon,
    });
    expect(board.effective).toHaveLength(15);
    expect(board.activations).toHaveLength(0);
  });

  it("one OUT promotes R1 into last active slot", () => {
    const board = deriveEffectiveBoard({
      picks: top10WithReserves({
        7: { availability: "OUT" },
      }),
      scoringDepth: 10,
      now: fridayNoon,
    });
    expect(board.effective.map((r) => r.rankableEntryId)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
      "p8",
      "p9",
      "p10",
      "p11",
    ]);
    expect(board.activations).toEqual([
      expect.objectContaining({
        reserveEntryId: "p11",
        reserveSlot: 1,
        effectiveRank: 10,
        replacedEntryId: "p7",
      }),
    ]);
  });

  it("two OUT promotes R1 + R2", () => {
    const board = deriveEffectiveBoard({
      picks: top10WithReserves({
        1: { availability: "OUT" },
        7: { availability: "IR" },
      }),
      scoringDepth: 10,
      now: fridayNoon,
    });
    expect(board.effective.map((r) => r.rankableEntryId)).toEqual([
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
      "p8",
      "p9",
      "p10",
      "p11",
      "p12",
    ]);
    expect(board.activations).toHaveLength(2);
  });

  it("removing #1 shifts everyone and reserve enters final slot", () => {
    const board = deriveEffectiveBoard({
      picks: top10WithReserves({
        1: { availability: "SUSPENDED" },
      }),
      scoringDepth: 10,
      now: fridayNoon,
    });
    expect(board.effective[0]?.rankableEntryId).toBe("p2");
    expect(board.effective[9]?.rankableEntryId).toBe("p11");
    expect(board.effective[9]?.predictedRank).toBe(10);
  });

  it("Q/D do not promote", () => {
    const board = deriveEffectiveBoard({
      picks: top10WithReserves({
        5: { availability: "QUESTIONABLE" },
        6: { availability: "DOUBTFUL" },
      }),
      scoringDepth: 10,
      now: fridayNoon,
    });
    expect(board.activations).toHaveLength(0);
    expect(board.effective).toHaveLength(10);
  });

  it("no reserve available leaves short effective board safely", () => {
    const picks = top10WithReserves({
      3: { availability: "OUT" },
      4: { availability: "OUT" },
      5: { availability: "OUT" },
    }).slice(0, 10);
    const board = deriveEffectiveBoard({
      picks,
      scoringDepth: 10,
      now: fridayNoon,
    });
    expect(board.effective).toHaveLength(7);
    expect(board.activations).toHaveLength(0);
  });

  it("unavailable reserve is skipped; R2 may still promote", () => {
    const board = deriveEffectiveBoard({
      picks: top10WithReserves({
        7: { availability: "OUT" },
        11: { availability: "OUT" },
      }),
      scoringDepth: 10,
      now: fridayNoon,
    });
    expect(board.activations[0]?.reserveEntryId).toBe("p12");
    expect(board.effective[9]?.rankableEntryId).toBe("p12");
  });
});

describe("anti-hindsight", () => {
  it("locked reserve may promote for original predecessor OUT", () => {
    const thursdayPredecessors = [
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
      "p7",
      "p8",
      "p9",
      "p10",
    ];
    const board = deriveEffectiveBoard({
      picks: top10WithReserves({
        7: {
          availability: "OUT",
          kickoffAt: sundayKick,
          wasUnavailableAtKickoff: true,
        },
        11: {
          kickoffAt: thursdayKick,
          reserveEligiblePredecessorIds: thursdayPredecessors,
          wasUnavailableAtKickoff: false,
        },
      }),
      scoringDepth: 10,
      now: sunday,
    });
    expect(board.activations).toHaveLength(1);
    expect(board.activations[0]?.reserveEntryId).toBe("p11");
  });

  it("locked reserve may NOT promote for player added after reserve kickoff", () => {
    // At Thursday lock, predecessors were p1-p10. Friday user inserted newP at #8
    // (original board now has newP as #8; p8-p10 slid). newP was never a predecessor.
    const thursdayPredecessors = [
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
      "p7",
      "p8",
      "p9",
      "p10",
    ];
    const picks = top10WithReserves({
      8: {
        rankableEntryId: "newP",
        availability: "OUT",
        kickoffAt: sundayKick,
        wasUnavailableAtKickoff: true,
      },
      11: {
        kickoffAt: thursdayKick,
        reserveEligiblePredecessorIds: thursdayPredecessors,
        wasUnavailableAtKickoff: false,
      },
      12: {
        kickoffAt: thursdayKick,
        reserveEligiblePredecessorIds: thursdayPredecessors,
        wasUnavailableAtKickoff: false,
      },
    });
    const board = deriveEffectiveBoard({
      picks,
      scoringDepth: 10,
      now: sunday,
    });
    expect(board.activations).toHaveLength(0);
    expect(board.effective).toHaveLength(9);
    expect(
      board.effective.find((r) => r.rankableEntryId === "p11"),
    ).toBeUndefined();
  });

  it("unlocked reserve (no snapshot yet) may promote for any OUT", () => {
    const board = deriveEffectiveBoard({
      picks: top10WithReserves({
        8: { rankableEntryId: "newP", availability: "OUT" },
        11: { reserveEligiblePredecessorIds: null },
      }),
      scoringDepth: 10,
      now: fridayNoon,
    });
    expect(board.activations[0]?.reserveEntryId).toBe("p11");
  });
});

describe("snapshotReservePredecessors", () => {
  it("captures active board ahead of reserve", () => {
    const ids = snapshotReservePredecessors({
      picks: top10WithReserves(),
      reservePredictedRank: 11,
      scoringDepth: 10,
    });
    expect(ids).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
      "p7",
      "p8",
      "p9",
      "p10",
    ]);
  });
});
