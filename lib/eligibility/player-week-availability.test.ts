import { describe, expect, it } from "vitest";
import {
  formatAvailabilityPromptParts,
  isRosterUnavailableStatus,
  resolvePlayerWeekStatus,
  WEEKLY_UNAVAILABLE_DESIGNATIONS,
} from "@/lib/eligibility/player-week-availability";
import { isPromotionUnavailable } from "@/lib/reserves/promotion-status";
import {
  buildAiRankingPrompt,
  partitionAiPromptPlayers,
  type AiPromptContest,
} from "@/lib/admin/ai-prompt";
import { zonedLocalToUtc } from "@/lib/timing/chicago";

describe("PlayerWeekAvailability resolution", () => {
  it("ACTIVE roster + weekly OUT = unavailable", () => {
    const status = resolvePlayerWeekStatus({
      nflStatus: "ACTIVE",
      weekDesignation: "OUT",
      injuryDescription: "hip/glute",
    });
    expect(status.selectable).toBe(false);
    expect(status.weeklyUnavailable).toBe(true);
    expect(status.rosterUnavailable).toBe(false);
    expect(status.promotionUnavailable).toBe(true);
    expect(status.unavailableReason).toBe("OUT");
    expect(status.effectiveEntryAvailability).toBe("OUT");
  });

  it("no weekly record means UNKNOWN, not AVAILABLE", () => {
    const status = resolvePlayerWeekStatus({
      nflStatus: "ACTIVE",
      weekDesignation: null,
      fallbackEntryAvailability: "ACTIVE",
    });
    expect(status.designation).toBe("UNKNOWN");
    expect(status.selectable).toBe(true);
    expect(status.eligibleDisclosure).toBe("UNKNOWN");
    expect(status.promotionUnavailable).toBe(false);
  });

  it("ACTIVE roster + weekly INACTIVE = unavailable", () => {
    const status = resolvePlayerWeekStatus({
      nflStatus: "ACTIVE",
      weekDesignation: "INACTIVE",
    });
    expect(status.selectable).toBe(false);
    expect(status.promotionUnavailable).toBe(true);
    expect(status.unavailableReason).toBe("INACTIVE");
  });

  it("ACTIVE roster + QUESTIONABLE = eligible with disclosure", () => {
    const status = resolvePlayerWeekStatus({
      nflStatus: "ACTIVE",
      weekDesignation: "QUESTIONABLE",
      injuryDescription: "ankle; limited Wednesday",
    });
    expect(status.selectable).toBe(true);
    expect(status.promotionUnavailable).toBe(false);
    expect(status.eligibleDisclosure).toBe("QUESTIONABLE");
    expect(isPromotionUnavailable(status.effectiveEntryAvailability)).toBe(
      false,
    );
  });

  it("ACTIVE roster + DOUBTFUL = eligible with disclosure", () => {
    const status = resolvePlayerWeekStatus({
      nflStatus: "ACTIVE",
      weekDesignation: "DOUBTFUL",
      injuryDescription: "hamstring",
    });
    expect(status.selectable).toBe(true);
    expect(status.promotionUnavailable).toBe(false);
    expect(status.eligibleDisclosure).toBe("DOUBTFUL");
  });

  it("IR/PUP/SUSPENDED/FREE_AGENT unavailable regardless of weekly designation", () => {
    for (const roster of ["IR", "PUP", "SUSPENDED", "FREE_AGENT", "FA"] as const) {
      for (const week of ["AVAILABLE", "QUESTIONABLE", "OUT"] as const) {
        const status = resolvePlayerWeekStatus({
          nflStatus: roster,
          weekDesignation: week,
        });
        expect(status.selectable).toBe(false);
        expect(status.rosterUnavailable).toBe(true);
        expect(status.promotionUnavailable).toBe(true);
        expect(isRosterUnavailableStatus(roster)).toBe(true);
      }
    }
  });

  it("UNKNOWN remains selectable with disclosure", () => {
    const status = resolvePlayerWeekStatus({
      nflStatus: "ACTIVE",
      weekDesignation: "UNKNOWN",
    });
    expect(status.selectable).toBe(true);
    expect(status.promotionUnavailable).toBe(false);
    expect(status.eligibleDisclosure).toBe("UNKNOWN");
  });

  it("QUESTIONABLE/DOUBTFUL/UNKNOWN do not trigger promotion", () => {
    for (const week of ["QUESTIONABLE", "DOUBTFUL", "UNKNOWN", "AVAILABLE"] as const) {
      const status = resolvePlayerWeekStatus({
        nflStatus: "ACTIVE",
        weekDesignation: week,
      });
      expect(status.promotionUnavailable).toBe(false);
      expect(WEEKLY_UNAVAILABLE_DESIGNATIONS.has(week)).toBe(false);
    }
  });

  it("formats prompt parts with injury note", () => {
    expect(
      formatAvailabilityPromptParts({
        name: "Sam Darnold",
        team: "SEA",
        designation: "OUT",
        injuryDescription: "hip/glute",
      }),
    ).toBe("Sam Darnold — SEA — OUT — hip/glute");
  });
});

describe("AI prompt weekly availability sections", () => {
  const generatedAt = zonedLocalToUtc(2026, 9, 10, 9, 30);
  const contest: AiPromptContest = {
    title: "QB Top 10",
    seasonYear: 2026,
    sport: "NFL",
    weekLabel: "Week 2",
    weekNumber: 2,
    position: "QB",
    rankingDepth: 10,
    submissionDepth: 12,
    rankingsOpenAt: zonedLocalToUtc(2026, 9, 8, 0, 0),
    fullLockAt: zonedLocalToUtc(2026, 9, 13, 10, 0),
    players: [
      {
        name: "Sam Player",
        team: "SEA",
        opponent: "vs ARI",
        gameStartsAt: zonedLocalToUtc(2026, 9, 13, 12, 0),
        designation: "QUESTIONABLE",
        availability: "QUESTIONABLE",
        injuryDescription: "ankle; limited Wednesday",
      },
      {
        name: "Alex Player",
        team: "DAL",
        opponent: "vs NYG",
        gameStartsAt: zonedLocalToUtc(2026, 9, 13, 12, 0),
        designation: "AVAILABLE",
        availability: "ACTIVE",
      },
      {
        name: "Chris Player",
        team: "MIA",
        opponent: "@ BUF",
        gameStartsAt: zonedLocalToUtc(2026, 9, 13, 12, 0),
        designation: "DOUBTFUL",
        availability: "DOUBTFUL",
        injuryDescription: "hamstring",
      },
      {
        name: "Sam Darnold",
        team: "SEA",
        opponent: "vs ARI",
        gameStartsAt: zonedLocalToUtc(2026, 9, 13, 12, 0),
        designation: "OUT",
        availability: "OUT",
        injuryDescription: "hip/glute",
        unavailableReason: "OUT",
      },
      {
        name: "Example Player",
        team: "MIN",
        opponent: "vs CHI",
        gameStartsAt: zonedLocalToUtc(2026, 9, 13, 12, 0),
        designation: "AVAILABLE",
        availability: "IR",
        unavailableReason: "IR",
      },
    ],
  };

  it("puts OUT and IR only under UNAVAILABLE; Q/D stay eligible with disclosure", () => {
    const { eligible, unavailable, kickedOff } = partitionAiPromptPlayers(
      contest.players,
      generatedAt,
    );
    expect(eligible.map((p) => p.name).sort()).toEqual([
      "Alex Player",
      "Chris Player",
      "Sam Player",
    ]);
    expect(unavailable.map((p) => p.name).sort()).toEqual([
      "Example Player",
      "Sam Darnold",
    ]);
    expect(kickedOff).toHaveLength(0);

    const prompt = buildAiRankingPrompt(contest, { generatedAt });
    expect(prompt).toContain("ELIGIBLE PLAYER POOL");
    expect(prompt).toContain("Sam Player — SEA — QUESTIONABLE — ankle; limited Wednesday");
    expect(prompt).toContain("Alex Player — DAL — AVAILABLE");
    expect(prompt).toContain("Chris Player — MIA — DOUBTFUL — hamstring");
    expect(prompt).toContain("UNAVAILABLE — DO NOT SELECT");
    expect(prompt).toContain("Sam Darnold — SEA — OUT — hip/glute");
    expect(prompt).toContain("Example Player — MIN — IR");
    expect(prompt).toContain("Select players only from the ELIGIBLE PLAYER POOL");
    expect(prompt).toContain("Never select anyone listed under UNAVAILABLE");
    expect(prompt).toContain("QUESTIONABLE and DOUBTFUL players appear in the eligible pool");
    expect(prompt).toContain("Eligible pool count: 3");
    expect(prompt).toContain("Unavailable count: 2");
    expect(prompt).toContain("RANKEYEQ_AI_WEEKLY_V5");
    expect(prompt).not.toContain("AI competitor:");
  });

  it("shows empty eligible pool when count is zero", () => {
    const prompt = buildAiRankingPrompt(
      {
        ...contest,
        players: contest.players.filter((p) => p.unavailableReason),
      },
      { generatedAt },
    );
    expect(prompt).toContain("eligible pool count is 0");
    expect(prompt).toContain("Eligible pool count: 0");
  });
});
