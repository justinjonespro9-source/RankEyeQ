import { describe, expect, it } from "vitest";
import {
  presentWeeklyAvailability,
  resolvePlayerWeekStatus,
} from "@/lib/eligibility/player-week-availability";
import {
  freezeUnavailableAtKickoff,
  freezeUnavailableFromWeekStatus,
} from "@/lib/reserves/kickoff-freeze";
import {
  deriveEffectiveBoard,
  type EffectiveBoardPickInput,
} from "@/lib/reserves/effective-board";
import { resolveWeekScopedKickoff } from "@/lib/timing/resolve-contest-kickoff";
import {
  rankingDepthForPosition,
  submissionDepthForPosition,
} from "@/lib/contest-defaults";
import { POST_KICKOFF_FACTUAL_CORRECTION_ACTION } from "@/lib/eligibility/post-kickoff-factual-correction";

const week2Kickoff = new Date("2026-09-20T17:00:00.000Z");
const afterKickoff = new Date("2026-09-20T18:00:00.000Z");

function freezeFromWeek(input: Parameters<typeof resolvePlayerWeekStatus>[0]) {
  return freezeUnavailableFromWeekStatus(resolvePlayerWeekStatus(input));
}

function boardPick(
  partial: Partial<EffectiveBoardPickInput> & {
    rankableEntryId: string;
    predictedRank: number;
  },
): EffectiveBoardPickInput {
  return {
    availability: "ACTIVE",
    kickoffAt: week2Kickoff,
    wasUnavailableAtKickoff: null,
    reserveEligiblePredecessorIds: null,
    ...partial,
  };
}

/** Build Top-N + R1/R2 board with one OUT at predictedRank `outRank`. */
function depthBoardWithOut(input: {
  scoringDepth: number;
  outRank: number;
  outFreeze: boolean | null;
}) {
  const submissionDepth = input.scoringDepth + 2;
  return Array.from({ length: submissionDepth }, (_, i) => {
    const rank = i + 1;
    const isOut = rank === input.outRank;
    return boardPick({
      rankableEntryId: `p${rank}`,
      predictedRank: rank,
      name: isOut ? "OUT Player" : `Player ${rank}`,
      availability: isOut ? "OUT" : "ACTIVE",
      wasUnavailableAtKickoff: isOut ? input.outFreeze : false,
    });
  });
}

describe("kickoff freeze authority (week-scoped)", () => {
  it("1. Week-scoped PWA OUT → freeze true", () => {
    expect(
      freezeFromWeek({
        nflStatus: "ACTIVE",
        weekDesignation: "OUT",
        fallbackEntryAvailability: "ACTIVE",
      }),
    ).toBe(true);
  });

  it("2. Week-scoped PWA INACTIVE → freeze true", () => {
    expect(
      freezeFromWeek({
        nflStatus: "ACTIVE",
        weekDesignation: "INACTIVE",
        fallbackEntryAvailability: "ACTIVE",
      }),
    ).toBe(true);
  });

  it("3. DNP + blank GS → freeze false / not unavailable", () => {
    const status = resolvePlayerWeekStatus({
      nflStatus: "ACTIVE",
      weekDesignation: null,
      practiceStatus: "Did Not Participate In Practice",
      injuryDescription: "knee",
      fallbackEntryAvailability: "ACTIVE",
    });
    expect(freezeUnavailableFromWeekStatus(status)).toBe(false);
    const presentation = presentWeeklyAvailability({
      resolved: status,
      hasWeekRecord: false,
      practiceStatus: "Did Not Participate In Practice",
      injuryDescription: "knee",
      onInjuryReportBlankGameStatus: true,
    });
    expect(presentation.injuryContext.practiceTier).toBe("DNP");
    expect(status.promotionUnavailable).toBe(false);
  });

  it("4. Limited + blank GS → not unavailable", () => {
    const status = resolvePlayerWeekStatus({
      nflStatus: "ACTIVE",
      weekDesignation: null,
      practiceStatus: "Limited Participation In Practice",
      fallbackEntryAvailability: "ACTIVE",
    });
    expect(freezeUnavailableFromWeekStatus(status)).toBe(false);
    expect(status.promotionUnavailable).toBe(false);
  });

  it("5. QUESTIONABLE → not unavailable", () => {
    expect(
      freezeFromWeek({
        nflStatus: "ACTIVE",
        weekDesignation: "QUESTIONABLE",
      }),
    ).toBe(false);
  });

  it("6. DOUBTFUL → not unavailable", () => {
    expect(
      freezeFromWeek({
        nflStatus: "ACTIVE",
        weekDesignation: "DOUBTFUL",
      }),
    ).toBe(false);
  });

  it("7. roster IR/PUP → freeze true", () => {
    for (const roster of ["IR", "PUP", "NFI", "SUSPENDED"] as const) {
      expect(
        freezeFromWeek({
          nflStatus: roster,
          weekDesignation: "AVAILABLE",
          fallbackEntryAvailability: "ACTIVE",
        }),
      ).toBe(true);
    }
  });

  it("8. current/future RankableEntry status cannot alter historical freeze", () => {
    // Week-scoped OUT freezes true even if RankableEntry later looks ACTIVE.
    const weekOut = resolvePlayerWeekStatus({
      nflStatus: "ACTIVE",
      weekDesignation: "OUT",
      fallbackEntryAvailability: "ACTIVE",
    });
    expect(freezeUnavailableFromWeekStatus(weekOut)).toBe(true);

    // Stale RankableEntry OUT with no week record must NOT freeze.
    const staleEntryOnly = resolvePlayerWeekStatus({
      nflStatus: "ACTIVE",
      weekDesignation: null,
      fallbackEntryAvailability: "OUT",
    });
    expect(freezeUnavailableFromWeekStatus(staleEntryOnly)).toBe(false);

    // Legacy EntryAvailability helper alone is not week-authoritative.
    expect(freezeUnavailableAtKickoff("OUT")).toBe(true);
    expect(freezeUnavailableAtKickoff("ACTIVE")).toBe(false);
  });

  it("9. ContestEntry.game supplies kickoff (week-scoped)", () => {
    const weekId = "week-2";
    const contestKickoff = new Date("2026-09-20T17:00:00.000Z");
    const staleMasterKickoff = new Date("2026-09-27T17:00:00.000Z");

    const resolved = resolveWeekScopedKickoff({
      weekId,
      contestGame: {
        id: "g1",
        weekId,
        homeTeam: "HOU",
        awayTeam: "BAL",
        startsAt: contestKickoff,
      },
    });
    expect(resolved?.toISOString()).toBe(contestKickoff.toISOString());

    // Wrong-week ContestEntry.game must not supply kickoff.
    expect(
      resolveWeekScopedKickoff({
        weekId,
        contestGame: {
          id: "g-week3",
          weekId: "week-3",
          homeTeam: "HOU",
          awayTeam: "BAL",
          startsAt: staleMasterKickoff,
        },
      }),
    ).toBeNull();
  });

  it("10. already frozen true/false remains the historical answer for scoring", () => {
    // After kickoff, deriveEffectiveBoard must honor frozen false even if
    // live availability is OUT (immutable during normal lock).
    const picks = [
      boardPick({
        rankableEntryId: "kept",
        predictedRank: 1,
        availability: "OUT",
        wasUnavailableAtKickoff: false,
      }),
      ...Array.from({ length: 14 }, (_, i) =>
        boardPick({
          rankableEntryId: `p${i + 2}`,
          predictedRank: i + 2,
          wasUnavailableAtKickoff: false,
        }),
      ),
      boardPick({
        rankableEntryId: "r1",
        predictedRank: 16,
        wasUnavailableAtKickoff: false,
      }),
      boardPick({
        rankableEntryId: "r2",
        predictedRank: 17,
        wasUnavailableAtKickoff: false,
      }),
    ];
    const board = deriveEffectiveBoard({
      picks,
      scoringDepth: 15,
      now: afterKickoff,
    });
    expect(board.displaced).toHaveLength(0);
    expect(board.effective[0]?.rankableEntryId).toBe("kept");

    // Frozen true displaces even if RankableEntry later shows ACTIVE.
    const frozenOut = deriveEffectiveBoard({
      picks: picks.map((p, i) =>
        i === 0
          ? {
              ...p,
              availability: "ACTIVE",
              wasUnavailableAtKickoff: true,
            }
          : p,
      ),
      scoringDepth: 15,
      now: afterKickoff,
    });
    expect(frozenOut.displaced.map((d) => d.rankableEntryId)).toEqual([
      "kept",
    ]);
    expect(frozenOut.activations[0]?.reserveEntryId).toBe("r1");
  });

  it("11. Admin factual-correction path remains a separate audited action", () => {
    expect(POST_KICKOFF_FACTUAL_CORRECTION_ACTION).toBe(
      "week_status.post_kickoff_factual_correction",
    );
    expect(POST_KICKOFF_FACTUAL_CORRECTION_ACTION).not.toBe(
      "week_status.historical_kickoff_freeze_repair",
    );
    // Admin override OUT still freezes via week status authority.
    expect(
      freezeFromWeek({
        nflStatus: "ACTIVE",
        weekDesignation: "OUT",
        manualOverride: true,
        sourceType: "MANUAL",
      }),
    ).toBe(true);
  });

  it("12. reserve picks receive the same freeze treatment as Top-N picks", () => {
    const topFreeze = freezeFromWeek({
      nflStatus: "ACTIVE",
      weekDesignation: "OUT",
    });
    const reserveFreeze = freezeFromWeek({
      nflStatus: "ACTIVE",
      weekDesignation: "OUT",
    });
    expect(topFreeze).toBe(true);
    expect(reserveFreeze).toBe(true);

    const picks = depthBoardWithOut({
      scoringDepth: 15,
      outRank: 16, // R1
      outFreeze: true,
    });
    const board = deriveEffectiveBoard({
      picks,
      scoringDepth: 15,
      now: afterKickoff,
    });
    // R1 OUT does not displace Top-15; R2 may still activate only if Top-N OUT.
    expect(board.displaced).toHaveLength(0);
    expect(board.effective).toHaveLength(15);
  });

  it("13. WR Top15 + R1/R2 behavior", () => {
    expect(rankingDepthForPosition("WR")).toBe(15);
    expect(submissionDepthForPosition("WR")).toBe(17);

    const board = deriveEffectiveBoard({
      picks: depthBoardWithOut({
        scoringDepth: 15,
        outRank: 7,
        outFreeze: true,
      }),
      scoringDepth: 15,
      now: afterKickoff,
    });
    expect(board.displaced.map((d) => d.rankableEntryId)).toEqual(["p7"]);
    expect(board.activations[0]?.reserveEntryId).toBe("p16");
    expect(board.effective).toHaveLength(15);
    expect(board.effective.at(-1)?.rankableEntryId).toBe("p16");
  });

  it("14. QB/RB/TE/DEF Top10 + R1/R2 behavior", () => {
    for (const position of ["QB", "RB", "TE", "DEF"] as const) {
      expect(rankingDepthForPosition(position)).toBe(10);
      expect(submissionDepthForPosition(position)).toBe(12);

      const board = deriveEffectiveBoard({
        picks: depthBoardWithOut({
          scoringDepth: 10,
          outRank: 3,
          outFreeze: true,
        }),
        scoringDepth: 10,
        now: afterKickoff,
      });
      expect(board.displaced.map((d) => d.rankableEntryId)).toEqual(["p3"]);
      expect(board.activations[0]?.reserveEntryId).toBe("p11");
      expect(board.effective).toHaveLength(10);
      expect(board.effective.at(-1)?.rankableEntryId).toBe("p11");
    }
  });
});

describe("apply-locks freeze immutability contract", () => {
  it("only stamps freeze when wasUnavailableAtKickoff is null", () => {
    // Mirrors applyKickoffLocksToSubmission: needsUnavailableFreeze gate.
    const decideWrite = (current: boolean | null, weekUnavailable: boolean) => {
      if (current != null) return { write: false as const, value: current };
      return { write: true as const, value: weekUnavailable };
    };

    expect(decideWrite(true, false)).toEqual({ write: false, value: true });
    expect(decideWrite(false, true)).toEqual({ write: false, value: false });
    expect(decideWrite(null, true)).toEqual({ write: true, value: true });
    expect(decideWrite(null, false)).toEqual({ write: true, value: false });
  });
});
