import { describe, expect, it } from "vitest";
import {
  deriveEffectiveBoard,
  isDisplacedFromScoringBoard,
  type EffectiveBoardPickInput,
} from "@/lib/reserves/effective-board";
import {
  factualStatusQualifiesForReserveDisplacement,
  isPostKickoffCorrectionDesignation,
  zeroFantasyPointsAloneNeverDisplaces,
} from "@/lib/eligibility/post-kickoff-factual-correction";

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

const kickoff = new Date("2026-09-22T00:20:00Z");
const afterKickoff = new Date("2026-09-22T06:00:00Z");

describe("post-kickoff factual correction status semantics", () => {
  it("allows only OUT and INACTIVE as correction designations", () => {
    expect(isPostKickoffCorrectionDesignation("OUT")).toBe(true);
    expect(isPostKickoffCorrectionDesignation("INACTIVE")).toBe(true);
    expect(isPostKickoffCorrectionDesignation("QUESTIONABLE")).toBe(false);
    expect(isPostKickoffCorrectionDesignation("DOUBTFUL")).toBe(false);
    expect(isPostKickoffCorrectionDesignation("UNKNOWN")).toBe(false);
    expect(isPostKickoffCorrectionDesignation("AVAILABLE")).toBe(false);
    expect(isPostKickoffCorrectionDesignation("DNP")).toBe(false);
  });

  it("OUT/INACTIVE qualify for reserve displacement; points/snaps/DNP alone do not", () => {
    expect(factualStatusQualifiesForReserveDisplacement("OUT")).toBe(true);
    expect(factualStatusQualifiesForReserveDisplacement("INACTIVE")).toBe(
      true,
    );
    expect(factualStatusQualifiesForReserveDisplacement("QUESTIONABLE")).toBe(
      false,
    );
    expect(factualStatusQualifiesForReserveDisplacement("DOUBTFUL")).toBe(
      false,
    );
    expect(factualStatusQualifiesForReserveDisplacement("UNKNOWN")).toBe(
      false,
    );
    expect(factualStatusQualifiesForReserveDisplacement("DNP")).toBe(false);
    expect(factualStatusQualifiesForReserveDisplacement(null)).toBe(false);
    expect(zeroFantasyPointsAloneNeverDisplaces()).toBe(true);
  });
});

describe("Puka WR Top-15 post-kickoff correction → R1 fills #15", () => {
  const scoringDepth = 15;

  function wrBoard(overrides: {
    pukaFreeze: boolean | null;
    pukaAvailability?: string;
  }): EffectiveBoardPickInput[] {
    const picks: EffectiveBoardPickInput[] = [];
    for (let rank = 1; rank <= 12; rank += 1) {
      picks.push(
        pick({
          rankableEntryId: `filler-${rank}`,
          predictedRank: rank,
          kickoffAt: kickoff,
          wasUnavailableAtKickoff: false,
        }),
      );
    }
    const scoringAhead = [
      ...Array.from({ length: 12 }, (_, i) => `filler-${i + 1}`),
      "player-a",
      "puka",
      "player-b",
    ];
    picks.push(
      pick({
        rankableEntryId: "player-a",
        predictedRank: 13,
        kickoffAt: kickoff,
        wasUnavailableAtKickoff: false,
      }),
      pick({
        rankableEntryId: "puka",
        predictedRank: 14,
        availability: overrides.pukaAvailability ?? "QUESTIONABLE",
        kickoffAt: kickoff,
        wasUnavailableAtKickoff: overrides.pukaFreeze,
      }),
      pick({
        rankableEntryId: "player-b",
        predictedRank: 15,
        kickoffAt: kickoff,
        wasUnavailableAtKickoff: false,
      }),
      pick({
        rankableEntryId: "player-c",
        predictedRank: 16,
        kickoffAt: kickoff,
        wasUnavailableAtKickoff: false,
        reserveEligiblePredecessorIds: scoringAhead,
      }),
      pick({
        rankableEntryId: "player-d",
        predictedRank: 17,
        kickoffAt: kickoff,
        wasUnavailableAtKickoff: false,
        reserveEligiblePredecessorIds: [...scoringAhead, "player-c"],
      }),
    );
    return picks;
  }

  it("live OUT after kickoff does not displace without freeze revision", () => {
    expect(
      isDisplacedFromScoringBoard({
        availability: "OUT",
        kickoffAt: kickoff,
        wasUnavailableAtKickoff: false,
        now: afterKickoff,
      }),
    ).toBe(false);

    const board = deriveEffectiveBoard({
      picks: wrBoard({ pukaFreeze: false, pukaAvailability: "OUT" }),
      scoringDepth,
      now: afterKickoff,
    });
    expect(
      board.effective.find((row) => row.predictedRank === 14)?.rankableEntryId,
    ).toBe("puka");
    expect(board.activations).toHaveLength(0);
  });

  it("freeze revision promotes R1 to effective #15; original ranks unchanged", () => {
    const original = wrBoard({
      pukaFreeze: true,
      pukaAvailability: "OUT",
    });
    expect(original.find((p) => p.rankableEntryId === "puka")?.predictedRank).toBe(
      14,
    );
    expect(
      original.find((p) => p.rankableEntryId === "player-c")?.predictedRank,
    ).toBe(16);

    const board = deriveEffectiveBoard({
      picks: original,
      scoringDepth,
      now: afterKickoff,
    });

    const byEff = Object.fromEntries(
      board.effective.map((row) => [row.predictedRank, row.rankableEntryId]),
    );
    expect(byEff[13]).toBe("player-a");
    expect(byEff[14]).toBe("player-b");
    expect(byEff[15]).toBe("player-c");
    expect(board.activations[0]!.reserveEntryId).toBe("player-c");
    expect(board.activations[0]!.effectiveRank).toBe(15);
    expect(board.original.find((p) => p.rankableEntryId === "puka")?.predictedRank).toBe(
      14,
    );
    expect(
      board.original.find((p) => p.rankableEntryId === "player-c")?.predictedRank,
    ).toBe(16);
  });

  it("two factual OUTs promote R1 then R2 in order", () => {
    const picks = wrBoard({ pukaFreeze: true, pukaAvailability: "OUT" });
    const playerB = picks.find((p) => p.rankableEntryId === "player-b")!;
    playerB.wasUnavailableAtKickoff = true;
    playerB.availability = "OUT";

    const board = deriveEffectiveBoard({
      picks,
      scoringDepth,
      now: afterKickoff,
    });
    const byEff = Object.fromEntries(
      board.effective.map((row) => [row.predictedRank, row.rankableEntryId]),
    );
    expect(byEff[13]).toBe("player-a");
    expect(byEff[14]).toBe("player-c");
    expect(byEff[15]).toBe("player-d");
    expect(board.activations.map((a) => a.reserveEntryId)).toEqual([
      "player-c",
      "player-d",
    ]);
  });

  it("anti-hindsight: correcting OUT does not expand locked reserve predecessors", () => {
    const picks = wrBoard({ pukaFreeze: true, pukaAvailability: "OUT" });
    const r1 = picks.find((p) => p.rankableEntryId === "player-c")!;
    // R1 locked without Puka — freeze revision must not make R1 eligible for Puka.
    r1.reserveEligiblePredecessorIds = ["player-a"];
    const lockedBefore = [...r1.reserveEligiblePredecessorIds];

    const board = deriveEffectiveBoard({
      picks,
      scoringDepth,
      now: afterKickoff,
    });

    expect(r1.reserveEligiblePredecessorIds).toEqual(lockedBefore);
    expect(
      board.activations.some((a) => a.reserveEntryId === "player-c"),
    ).toBe(false);
    // Puka is still displaced; R2 already had Puka as a predecessor and may fill.
    expect(board.displaced.some((d) => d.rankableEntryId === "puka")).toBe(
      true,
    );
    expect(board.activations[0]?.reserveEntryId).toBe("player-d");
    expect(board.activations[0]?.replacedEntryId).toBe("puka");
  });

  it("anti-hindsight: uncovered slot when no locked reserve was eligible for Puka", () => {
    const picks = wrBoard({ pukaFreeze: true, pukaAvailability: "OUT" });
    const r1 = picks.find((p) => p.rankableEntryId === "player-c")!;
    const r2 = picks.find((p) => p.rankableEntryId === "player-d")!;
    r1.reserveEligiblePredecessorIds = ["player-a"];
    r2.reserveEligiblePredecessorIds = ["player-a", "player-c"];

    const board = deriveEffectiveBoard({
      picks,
      scoringDepth,
      now: afterKickoff,
    });

    expect(board.displaced.some((d) => d.rankableEntryId === "puka")).toBe(
      true,
    );
    expect(board.activations).toHaveLength(0);
    expect(board.effective).toHaveLength(scoringDepth - 1);
  });

  it("skips unavailable R1 and promotes available eligible R2", () => {
    const picks = wrBoard({ pukaFreeze: true, pukaAvailability: "OUT" });
    const r1 = picks.find((p) => p.rankableEntryId === "player-c")!;
    const r2 = picks.find((p) => p.rankableEntryId === "player-d")!;
    r1.availability = "INACTIVE";
    r1.wasUnavailableAtKickoff = true;
    r2.availability = "ACTIVE";
    r2.wasUnavailableAtKickoff = false;

    const board = deriveEffectiveBoard({
      picks,
      scoringDepth,
      now: afterKickoff,
    });

    expect(
      board.activations.some((a) => a.reserveEntryId === "player-c"),
    ).toBe(false);
    expect(board.activations[0]?.reserveEntryId).toBe("player-d");
    expect(board.activations[0]?.replacedEntryId).toBe("puka");
    expect(
      board.effective.find((row) => row.predictedRank === 15)?.rankableEntryId,
    ).toBe("player-d");
  });

  it("zero fantasy points / zero snaps alone never displace without freeze", () => {
    const board = deriveEffectiveBoard({
      picks: wrBoard({ pukaFreeze: false, pukaAvailability: "ACTIVE" }),
      scoringDepth,
      now: afterKickoff,
    });
    expect(board.displaced).toHaveLength(0);
    expect(board.activations).toHaveLength(0);
  });
});
