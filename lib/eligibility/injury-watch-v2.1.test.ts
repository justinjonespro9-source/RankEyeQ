import { describe, expect, it } from "vitest";
import {
  buildInjuryContext,
  derivePracticeTier,
  formatPlayerInjuryPromptBlock,
  injuryWatchPrimaryLabel,
  presentWeeklyAvailability,
  resolvePlayerWeekStatus,
} from "@/lib/eligibility/player-week-availability";
import {
  classifyInjuryContextChange,
  resolveInjurySyncDesignation,
} from "@/lib/nfl/injury-sync";
import { mapGameStatusToAvailability } from "@/lib/providers/nfl/nflcom/parse-injuries";

describe("Player Availability V2.1 Injury Watch", () => {
  it("1. blank GS + DNP → UNKNOWN selectable + Injury Watch DNP + AI context", () => {
    const resolved = resolvePlayerWeekStatus({
      nflStatus: "ACTIVE",
      weekDesignation: "UNKNOWN",
      practiceStatus: "Did Not Participate In Practice",
      injuryDescription: "knee",
    });
    expect(resolved.selectable).toBe(true);
    expect(resolved.designation).toBe("UNKNOWN");
    expect(resolved.injuryContext.practiceTier).toBe("DNP");
    expect(resolved.injuryContext.officialGameStatus).toBeNull();

    const presentation = presentWeeklyAvailability({
      resolved,
      hasWeekRecord: true,
      practiceStatus: "Did Not Participate In Practice",
      injuryDescription: "knee",
      onInjuryReportBlankGameStatus: true,
    });
    expect(presentation.designationLabel).toBe("Injury Watch · DNP");
    expect(presentation.injuryContext.bodyPart).toBe("knee");

    const ai = formatPlayerInjuryPromptBlock({
      name: "Jayden Daniels",
      team: "WAS",
      resolvedAvailabilityLabel: "AVAILABLE",
      selectable: true,
      practiceStatus: "Did Not Participate In Practice",
      injuryDescription: "knee",
      designation: "UNKNOWN",
    });
    expect(ai).toContain("Injury Watch: DNP");
    expect(ai).toContain("Injury: knee");
    expect(ai).toContain("Official Game Status: not yet issued");
    expect(ai).toContain("Selectable: yes");
    expect(ai).not.toContain("OUT");
  });

  it("2. blank GS + Limited → selectable + Injury Watch Limited", () => {
    const resolved = resolvePlayerWeekStatus({
      nflStatus: "ACTIVE",
      weekDesignation: "UNKNOWN",
      practiceStatus: "Limited Participation in Practice",
      injuryDescription: "ankle",
    });
    expect(resolved.selectable).toBe(true);
    const presentation = presentWeeklyAvailability({
      resolved,
      hasWeekRecord: true,
      onInjuryReportBlankGameStatus: true,
    });
    expect(presentation.designationLabel).toBe("Injury Watch · Limited");
    expect(presentation.injuryContext.practiceTier).toBe("LIMITED");
  });

  it("3. blank GS + Full → selectable, no prominent Injury Watch warning", () => {
    const resolved = resolvePlayerWeekStatus({
      nflStatus: "ACTIVE",
      weekDesignation: "UNKNOWN",
      practiceStatus: "Full Participation in Practice",
      injuryDescription: "shoulder",
    });
    expect(resolved.selectable).toBe(true);
    const presentation = presentWeeklyAvailability({
      resolved,
      hasWeekRecord: true,
      onInjuryReportBlankGameStatus: true,
    });
    expect(presentation.designationLabel).toBe("No official status yet");
    expect(presentation.designationLabel).not.toMatch(/Injury Watch/);
    expect(presentation.injuryContext.practiceTier).toBe("FULL");
    expect(presentation.injuryContext.bodyPart).toBe("shoulder");

    const ai = formatPlayerInjuryPromptBlock({
      name: "Player Full",
      team: "KC",
      resolvedAvailabilityLabel: "AVAILABLE",
      selectable: true,
      practiceStatus: "Full Participation in Practice",
      injuryDescription: "shoulder",
      designation: "UNKNOWN",
    });
    expect(ai).toContain("Practice: Full Participation in Practice");
    expect(ai).not.toContain("Injury Watch:");
  });

  it("4. official QUESTIONABLE → Q primary + selectable", () => {
    const resolved = resolvePlayerWeekStatus({
      nflStatus: "ACTIVE",
      weekDesignation: "QUESTIONABLE",
      practiceStatus: "Limited Participation in Practice",
      injuryDescription: "ankle",
      sourceType: "NFL_SYNC",
    });
    expect(resolved.selectable).toBe(true);
    const presentation = presentWeeklyAvailability({
      resolved,
      hasWeekRecord: true,
      onInjuryReportOfficialGameStatus: true,
    });
    expect(presentation.designationLabel).toBe("Questionable");
    expect(presentation.sourceKind).toBe("OFFICIAL_GAME_STATUS");
  });

  it("5. official DOUBTFUL → D primary + selectable", () => {
    const resolved = resolvePlayerWeekStatus({
      nflStatus: "ACTIVE",
      weekDesignation: "DOUBTFUL",
      sourceType: "NFL_SYNC",
    });
    expect(resolved.selectable).toBe(true);
    const presentation = presentWeeklyAvailability({
      resolved,
      hasWeekRecord: true,
      onInjuryReportOfficialGameStatus: true,
    });
    expect(presentation.designationLabel).toBe("Doubtful");
  });

  it("6. official OUT → OUT primary + unavailable", () => {
    const resolved = resolvePlayerWeekStatus({
      nflStatus: "ACTIVE",
      weekDesignation: "OUT",
      practiceStatus: "Did Not Participate In Practice",
      sourceType: "NFL_SYNC",
    });
    expect(resolved.selectable).toBe(false);
    const presentation = presentWeeklyAvailability({
      resolved,
      hasWeekRecord: true,
      onInjuryReportOfficialGameStatus: true,
    });
    expect(presentation.designationLabel).toBe("Out");
    expect(presentation.designationLabel).not.toMatch(/Injury Watch/);
  });

  it("7–8. DNP and Limited never produce Q/D/OUT designations", () => {
    for (const practice of [
      "Did Not Participate In Practice",
      "Limited Participation in Practice",
      "DNP",
      "Limited",
    ]) {
      expect(mapGameStatusToAvailability(practice)).toBeNull();
      expect(derivePracticeTier(practice)).not.toBeNull();
      const designation = resolveInjurySyncDesignation({
        gameStatus: null,
        existingDesignation: null,
      });
      expect(designation).toBe("UNKNOWN");
      expect(["QUESTIONABLE", "DOUBTFUL", "OUT"]).not.toContain(designation);
    }
  });

  it("9. roster IR beats practice context", () => {
    const resolved = resolvePlayerWeekStatus({
      nflStatus: "IR",
      weekDesignation: "UNKNOWN",
      practiceStatus: "Did Not Participate In Practice",
    });
    expect(resolved.selectable).toBe(false);
    expect(resolved.unavailableReason).toBe("IR");
    const presentation = presentWeeklyAvailability({
      resolved,
      hasWeekRecord: true,
      onInjuryReportBlankGameStatus: true,
    });
    expect(presentation.sourceKind).toBe("ROSTER_UNAVAILABLE");
    expect(presentation.designationLabel).not.toMatch(/Injury Watch/);
  });

  it("10. ADMIN_OVERRIDE designation is preserved conceptually under practice update", () => {
    const resolved = resolvePlayerWeekStatus({
      nflStatus: "ACTIVE",
      weekDesignation: "OUT",
      manualOverride: true,
      practiceStatus: "Full Participation in Practice",
      sourceType: "MANUAL",
    });
    expect(resolved.manualOverride).toBe(true);
    expect(resolved.designation).toBe("OUT");
    expect(resolved.selectable).toBe(false);
    const presentation = presentWeeklyAvailability({
      resolved,
      hasWeekRecord: true,
      practiceStatus: "Did Not Participate In Practice",
    });
    expect(presentation.sourceKind).toBe("ADMIN_OVERRIDE");
    expect(presentation.designationLabel).toBe("Out");
  });

  it("11. blank NFL Game Status cannot erase existing official Q/D/OUT", () => {
    expect(
      resolveInjurySyncDesignation({
        gameStatus: null,
        existingDesignation: "OUT",
      }),
    ).toBe("OUT");
    expect(
      resolveInjurySyncDesignation({
        gameStatus: null,
        existingDesignation: "QUESTIONABLE",
      }),
    ).toBe("QUESTIONABLE");
    expect(
      resolveInjurySyncDesignation({
        gameStatus: null,
        existingDesignation: "DOUBTFUL",
      }),
    ).toBe("DOUBTFUL");
    expect(
      resolveInjurySyncDesignation({
        gameStatus: null,
        existingDesignation: "UNKNOWN",
      }),
    ).toBe("UNKNOWN");
  });

  it("12. Human and AI use the same InjuryContext builder", () => {
    const context = buildInjuryContext({
      injuryDescription: "knee",
      practiceStatus: "Did Not Participate In Practice",
      designation: "UNKNOWN",
    });
    expect(injuryWatchPrimaryLabel(context)).toBe("Injury Watch · DNP");
    const human = presentWeeklyAvailability({
      resolved: resolvePlayerWeekStatus({
        nflStatus: "ACTIVE",
        weekDesignation: "UNKNOWN",
        practiceStatus: context.practiceStatusRaw,
        injuryDescription: context.bodyPart,
      }),
      hasWeekRecord: true,
      onInjuryReportBlankGameStatus: true,
    });
    expect(human.injuryContext).toEqual(context);
    const ai = formatPlayerInjuryPromptBlock({
      name: "P",
      team: "WAS",
      resolvedAvailabilityLabel: "AVAILABLE",
      selectable: true,
      practiceStatus: context.practiceStatusRaw,
      injuryDescription: context.bodyPart,
      designation: "UNKNOWN",
    });
    expect(ai).toContain("Injury Watch: DNP");
    expect(ai).toContain("Injury: knee");
  });

  it("classifies preview change kinds for practice vs designation", () => {
    expect(
      classifyInjuryContextChange({
        existing: null,
        proposedDesignation: "UNKNOWN",
        proposedPractice: "Did Not Participate In Practice",
        proposedInjury: "knee",
      }),
    ).toBe("practice_context");

    expect(
      classifyInjuryContextChange({
        existing: {
          designation: "UNKNOWN",
          injuryDescription: null,
          practiceStatus: "Did Not Participate In Practice",
          manualOverride: false,
          sourceType: "NFL_SYNC",
        },
        proposedDesignation: "UNKNOWN",
        proposedPractice: "Did Not Participate In Practice",
        proposedInjury: "knee",
      }),
    ).toBe("injury_description");

    expect(
      classifyInjuryContextChange({
        existing: {
          designation: "UNKNOWN",
          injuryDescription: "knee",
          practiceStatus: "Did Not Participate In Practice",
          manualOverride: false,
          sourceType: "NFL_SYNC",
        },
        proposedDesignation: "OUT",
        proposedPractice: "Did Not Participate In Practice",
        proposedInjury: "knee",
      }),
    ).toBe("designation");
  });
});
