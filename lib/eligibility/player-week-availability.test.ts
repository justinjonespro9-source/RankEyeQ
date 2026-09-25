import { describe, expect, it } from "vitest";
import {
  formatAvailabilityPromptParts,
  isRosterUnavailableStatus,
  presentWeeklyAvailability,
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

  it("stale RankableEntry OUT does not become current-week OUT", () => {
    const status = resolvePlayerWeekStatus({
      nflStatus: "ACTIVE",
      weekDesignation: null,
      fallbackEntryAvailability: "OUT",
    });
    expect(status.designation).toBe("UNKNOWN");
    expect(status.weeklyUnavailable).toBe(false);
    expect(status.selectable).toBe(true);
    expect(status.promotionUnavailable).toBe(false);
  });

  it("stale RankableEntry QUESTIONABLE/DOUBTFUL do not become current-week Q/D", () => {
    for (const stale of ["QUESTIONABLE", "DOUBTFUL", "INACTIVE"] as const) {
      const status = resolvePlayerWeekStatus({
        nflStatus: "ACTIVE",
        weekDesignation: null,
        fallbackEntryAvailability: stale,
      });
      expect(status.designation).toBe("UNKNOWN");
      expect(status.weeklyUnavailable).toBe(false);
    }
  });

  it("presents practice-only as No official status yet", () => {
    const resolved = resolvePlayerWeekStatus({
      nflStatus: "ACTIVE",
      weekDesignation: null,
    });
    const presentation = presentWeeklyAvailability({
      resolved,
      hasWeekRecord: false,
      practiceStatus: "Did Not Participate In Practice",
      onInjuryReportBlankGameStatus: true,
    });
    expect(presentation.designationLabel).toBe("No official status yet");
    expect(presentation.sourceKind).toBe("PRACTICE_ONLY");
    expect(presentation.practiceStatus).toMatch(/Did Not Participate/i);
    expect(presentation.officialGameStatusLabel).toBe("No official status yet");
  });

  it("presents NFL_SYNC OUT with official game status badge", () => {
    const resolved = resolvePlayerWeekStatus({
      nflStatus: "ACTIVE",
      weekDesignation: "OUT",
      sourceType: "NFL_SYNC",
    });
    const presentation = presentWeeklyAvailability({
      resolved,
      hasWeekRecord: true,
      onInjuryReportOfficialGameStatus: true,
    });
    expect(presentation.designationLabel).toBe("Out");
    expect(presentation.sourceKind).toBe("OFFICIAL_GAME_STATUS");
    expect(presentation.sourceBadge).toContain("official game status");
  });

  it("presents Admin override distinctly", () => {
    const resolved = resolvePlayerWeekStatus({
      nflStatus: "ACTIVE",
      weekDesignation: "OUT",
      sourceType: "MANUAL",
      manualOverride: true,
    });
    const presentation = presentWeeklyAvailability({
      resolved,
      hasWeekRecord: true,
    });
    expect(presentation.sourceKind).toBe("ADMIN_OVERRIDE");
    expect(presentation.sourceBadge).toBe("Admin override");
  });

  it("presents roster IR above weekly designation", () => {
    const resolved = resolvePlayerWeekStatus({
      nflStatus: "IR",
      weekDesignation: "AVAILABLE",
    });
    const presentation = presentWeeklyAvailability({
      resolved,
      hasWeekRecord: true,
    });
    expect(presentation.sourceKind).toBe("ROSTER_UNAVAILABLE");
    expect(presentation.sourceBadge).toMatch(/Roster/);
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

  it("PRACTICE_SQUAD is hard-unavailable", () => {
    const status = resolvePlayerWeekStatus({
      nflStatus: "PRACTICE_SQUAD",
      weekDesignation: null,
    });
    expect(status.selectable).toBe(false);
    expect(status.rosterUnavailable).toBe(true);
    expect(status.unavailableReason).toBe("PRACTICE_SQUAD");
  });

  it("Admin override beats roster hard-unavailable", () => {
    const status = resolvePlayerWeekStatus({
      nflStatus: "IR",
      weekDesignation: "AVAILABLE",
      manualOverride: true,
    });
    expect(status.selectable).toBe(true);
    expect(status.rosterUnavailable).toBe(false);
    expect(status.manualOverride).toBe(true);
    expect(status.effectiveEntryAvailability).toBe("ACTIVE");
    const presentation = presentWeeklyAvailability({
      resolved: status,
      hasWeekRecord: true,
    });
    expect(presentation.sourceKind).toBe("ADMIN_OVERRIDE");
  });

  it("Jaxson Dart case: IR + blank GS + DNP → unavailable, not No official status yet", () => {
    const resolved = resolvePlayerWeekStatus({
      nflStatus: "IR",
      weekDesignation: null,
    });
    expect(resolved.selectable).toBe(false);
    expect(resolved.unavailableReason).toBe("IR");
    const presentation = presentWeeklyAvailability({
      resolved,
      hasWeekRecord: false,
      practiceStatus: "Did Not Participate In Practice",
      onInjuryReportBlankGameStatus: true,
    });
    expect(presentation.sourceKind).toBe("ROSTER_UNAVAILABLE");
    expect(presentation.sourceBadge).toMatch(/IR/);
    expect(presentation.designationLabel).not.toBe("No official status yet");
  });

  it("current roster IR does not reinterpret a historical week designation", () => {
    // Week 2 PWA OUT stays OUT for that week; current SeasonPlayer IR is a
    // separate input that only applies when resolving the current week.
    const week2Historical = resolvePlayerWeekStatus({
      nflStatus: "ACTIVE",
      weekDesignation: "OUT",
      sourceType: "NFL_SYNC",
    });
    expect(week2Historical.designation).toBe("OUT");
    expect(week2Historical.weeklyUnavailable).toBe(true);

    const week3Current = resolvePlayerWeekStatus({
      nflStatus: "IR",
      weekDesignation: null,
    });
    expect(week3Current.rosterUnavailable).toBe(true);
    expect(week3Current.designation).toBe("UNKNOWN");
    // Historical week2 resolution is independent of current IR.
    expect(week2Historical.designation).toBe("OUT");
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
