import { describe, expect, it } from "vitest";
import {
  resolveKickoffFreeze,
  type KickoffWeekAvailabilityEvidence,
} from "@/lib/reserves/kickoff-freeze-evidence";

const week2Kickoff = new Date("2026-09-20T17:00:00.000Z");
const week1Kickoff = new Date("2026-09-13T20:25:00.000Z");
const mnfKickoff = new Date("2026-09-22T00:15:00.000Z");
const week3Kickoff = new Date("2026-09-27T17:00:00.000Z");
/** Production roster sync that moved Brown / Njoku / Dart to IR (after Weeks 1–2). */
const sep25RosterSync = new Date("2026-09-25T01:35:08.080Z");
const preseasonImport = new Date("2026-09-04T02:37:48.051Z");

function weekRow(
  partial: Partial<KickoffWeekAvailabilityEvidence> & {
    designation: KickoffWeekAvailabilityEvidence["designation"];
  },
): KickoffWeekAvailabilityEvidence {
  const at = partial.updatedAt ?? new Date("2026-09-19T14:57:07.420Z");
  return {
    injuryDescription: null,
    practiceStatus: null,
    sourceType: "NFL_SYNC",
    sourceUrl: "https://www.nfl.com/injuries/",
    sourcePublishedAt: at,
    observedAt: partial.observedAt ?? at,
    manualOverride: false,
    updatedAt: at,
    ...partial,
  };
}

describe("resolveKickoffFreeze — kickoff-time evidence only", () => {
  it("weekly OUT persisted before kickoff freezes TRUE (Kyler Murray Week 2 shape)", () => {
    const decision = resolveKickoffFreeze({
      kickoffAt: week2Kickoff,
      weekRow: weekRow({
        designation: "OUT",
        injuryDescription: "Concussion",
        observedAt: new Date("2026-09-19T14:57:05.860Z"),
      }),
      roster: { nflStatus: "ACTIVE", updatedAt: preseasonImport },
    });
    expect(decision.unavailable).toBe(true);
    expect(decision.source).toBe("weekly_designation");
    expect(decision.reason).toBe("OUT");
    expect(decision.ignored).toEqual([]);
  });

  it("weekly OUT before kickoff freezes TRUE (Nico Collins Week 3 shape)", () => {
    const decision = resolveKickoffFreeze({
      kickoffAt: week3Kickoff,
      weekRow: weekRow({
        designation: "OUT",
        updatedAt: new Date("2026-09-26T01:46:34.886Z"),
        observedAt: new Date("2026-09-26T01:46:26.249Z"),
      }),
      roster: { nflStatus: "ACTIVE", updatedAt: new Date("2026-09-04T02:37:07.847Z") },
    });
    expect(decision.unavailable).toBe(true);
  });

  it.each([
    ["A.J. Brown", week1Kickoff, "IR"],
    ["A.J. Brown", week2Kickoff, "IR"],
    ["David Njoku", week1Kickoff, "IR"],
    ["David Njoku", week2Kickoff, "IR"],
    ["Jaxson Dart", week1Kickoff, "IR"],
    ["Jaxson Dart", week2Kickoff, "IR"],
    ["Josh Jacobs", week1Kickoff, "EXE"],
  ])(
    "%s: roster %s written after the %s kickoff cannot rewrite history",
    (_name, kickoffAt, status) => {
      const decision = resolveKickoffFreeze({
        kickoffAt,
        weekRow: null,
        roster: { nflStatus: status, updatedAt: sep25RosterSync },
      });
      expect(decision.unavailable).toBe(false);
      expect(decision.source).toBe("none");
      expect(decision.ignored).toEqual(["roster_updated_after_kickoff"]);
    },
  );

  it("the same roster IR persisted before a later kickoff is valid evidence", () => {
    const decision = resolveKickoffFreeze({
      kickoffAt: week3Kickoff,
      roster: { nflStatus: "IR", updatedAt: sep25RosterSync },
    });
    expect(decision.unavailable).toBe(true);
    expect(decision.source).toBe("roster_hard_unavailable");
    expect(decision.reason).toBe("IR");
  });

  it("roster hard-unavailable before kickoff outranks a weekly designation", () => {
    const decision = resolveKickoffFreeze({
      kickoffAt: week3Kickoff,
      weekRow: weekRow({
        designation: "QUESTIONABLE",
        updatedAt: new Date("2026-09-25T12:00:00Z"),
      }),
      roster: { nflStatus: "PUP", updatedAt: preseasonImport },
    });
    expect(decision.unavailable).toBe(true);
    expect(decision.source).toBe("roster_hard_unavailable");
  });

  it("weekly OUT written after kickoff is ignored (no future evidence)", () => {
    const decision = resolveKickoffFreeze({
      kickoffAt: week2Kickoff,
      weekRow: weekRow({
        designation: "OUT",
        updatedAt: new Date("2026-09-21T10:00:00Z"),
        observedAt: new Date("2026-09-21T10:00:00Z"),
      }),
    });
    expect(decision.unavailable).toBe(false);
    expect(decision.ignored).toEqual(["weekly_updated_after_kickoff"]);
  });

  it("weekly row observed after kickoff is ignored even if updatedAt looks earlier", () => {
    const decision = resolveKickoffFreeze({
      kickoffAt: week2Kickoff,
      weekRow: weekRow({
        designation: "OUT",
        updatedAt: new Date("2026-09-20T16:00:00Z"),
        observedAt: new Date("2026-09-20T18:00:00Z"),
      }),
    });
    expect(decision.unavailable).toBe(false);
    expect(decision.ignored).toEqual(["weekly_updated_after_kickoff"]);
  });

  it("evidence exactly at kickoff counts", () => {
    const decision = resolveKickoffFreeze({
      kickoffAt: week2Kickoff,
      weekRow: weekRow({ designation: "INACTIVE", updatedAt: week2Kickoff }),
    });
    expect(decision.unavailable).toBe(true);
    expect(decision.reason).toBe("INACTIVE");
  });

  it.each(["QUESTIONABLE", "DOUBTFUL", "UNKNOWN", "AVAILABLE"])(
    "%s before kickoff stays available",
    (designation) => {
      const decision = resolveKickoffFreeze({
        kickoffAt: week2Kickoff,
        weekRow: weekRow({ designation }),
        roster: { nflStatus: "ACTIVE", updatedAt: preseasonImport },
      });
      expect(decision.unavailable).toBe(false);
    },
  );

  it.each(["DNP", "LIMITED", "FULL"])(
    "practice %s alone never freezes unavailable",
    (practiceStatus) => {
      const decision = resolveKickoffFreeze({
        kickoffAt: week2Kickoff,
        weekRow: weekRow({ designation: "UNKNOWN", practiceStatus }),
      });
      expect(decision.unavailable).toBe(false);
    },
  );

  it("Admin override AVAILABLE before kickoff beats roster IR", () => {
    const decision = resolveKickoffFreeze({
      kickoffAt: week3Kickoff,
      weekRow: weekRow({
        designation: "AVAILABLE",
        sourceType: "MANUAL",
        manualOverride: true,
        updatedAt: new Date("2026-09-26T12:00:00Z"),
      }),
      roster: { nflStatus: "IR", updatedAt: preseasonImport },
    });
    expect(decision.unavailable).toBe(false);
  });

  it("Admin override OUT before kickoff freezes TRUE", () => {
    const decision = resolveKickoffFreeze({
      kickoffAt: week2Kickoff,
      weekRow: weekRow({
        designation: "OUT",
        sourceType: "MANUAL",
        manualOverride: true,
        updatedAt: new Date("2026-09-20T14:59:12.246Z"),
      }),
    });
    expect(decision.unavailable).toBe(true);
    expect(decision.source).toBe("admin_override");
  });

  it("post-kickoff override written after kickoff does not count without an audited correction", () => {
    const decision = resolveKickoffFreeze({
      kickoffAt: mnfKickoff,
      weekRow: weekRow({
        designation: "INACTIVE",
        sourceType: "MANUAL",
        manualOverride: true,
        updatedAt: new Date("2026-09-23T13:48:22.963Z"),
      }),
    });
    expect(decision.unavailable).toBe(false);
  });

  it("audited post-kickoff factual correction is honored (Puka Nacua shape)", () => {
    const decision = resolveKickoffFreeze({
      kickoffAt: mnfKickoff,
      weekRow: weekRow({
        designation: "INACTIVE",
        sourceType: "MANUAL",
        manualOverride: true,
        updatedAt: new Date("2026-09-23T13:48:22.963Z"),
      }),
      roster: { nflStatus: "ACTIVE", updatedAt: preseasonImport },
      factualCorrection: {
        designation: "INACTIVE",
        correctedAt: new Date("2026-09-23T13:48:23.204Z"),
      },
    });
    expect(decision.unavailable).toBe(true);
    expect(decision.source).toBe("post_kickoff_factual_correction");
    expect(decision.reason).toBe("INACTIVE");
  });

  it("no evidence at all resolves FALSE", () => {
    const decision = resolveKickoffFreeze({ kickoffAt: week2Kickoff });
    expect(decision).toMatchObject({
      unavailable: false,
      source: "none",
      reason: null,
      ignored: [],
    });
  });
});
