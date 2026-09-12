import { describe, expect, it } from "vitest";
import {
  canNewlySelectPlayer,
  canReplaceUnavailableSelection,
  isSelectableAvailability,
  isUnavailableAvailability,
  mapNflStatusToAvailability,
  availabilityPromptMarker,
} from "@/lib/eligibility/weekly-status";
import { zonedLocalToUtc } from "@/lib/timing/chicago";

describe("weekly availability eligibility", () => {
  it("ACTIVE / QUESTIONABLE / DOUBTFUL are selectable", () => {
    expect(isSelectableAvailability("ACTIVE")).toBe(true);
    expect(isSelectableAvailability("QUESTIONABLE")).toBe(true);
    expect(isSelectableAvailability("DOUBTFUL")).toBe(true);
  });

  it("OUT / IR / PUP / SUSPENDED / FREE_AGENT / INACTIVE are unavailable", () => {
    for (const status of [
      "OUT",
      "IR",
      "PUP",
      "SUSPENDED",
      "FREE_AGENT",
      "INACTIVE",
    ] as const) {
      expect(isUnavailableAvailability(status)).toBe(true);
      expect(canNewlySelectPlayer({ availability: status })).toBe(false);
    }
  });

  it("Brock Bowers OUT cannot be newly added before kickoff", () => {
    const kickoff = zonedLocalToUtc(2026, 9, 13, 12, 0);
    const now = zonedLocalToUtc(2026, 9, 12, 9, 0);
    expect(
      canNewlySelectPlayer({
        availability: "OUT",
        kickoffAt: kickoff,
        now,
      }),
    ).toBe(false);
  });

  it("existing OUT selection is replaceable before kickoff", () => {
    const kickoff = zonedLocalToUtc(2026, 9, 13, 12, 0);
    const now = zonedLocalToUtc(2026, 9, 12, 9, 0);
    expect(
      canReplaceUnavailableSelection({ kickoffAt: kickoff, now }),
    ).toBe(true);
  });

  it("OUT + kickoff passed is immutable (kickoff wins)", () => {
    const kickoff = zonedLocalToUtc(2026, 9, 13, 12, 0);
    const now = zonedLocalToUtc(2026, 9, 13, 12, 5);
    expect(
      canReplaceUnavailableSelection({ kickoffAt: kickoff, now }),
    ).toBe(false);
    expect(
      canNewlySelectPlayer({
        availability: "OUT",
        kickoffAt: kickoff,
        now,
      }),
    ).toBe(false);
  });

  it("maps NFL roster statuses onto availability", () => {
    expect(mapNflStatusToAvailability("IR")).toBe("IR");
    expect(mapNflStatusToAvailability("PUP")).toBe("PUP");
    expect(mapNflStatusToAvailability("SUSPENDED")).toBe("SUSPENDED");
    expect(mapNflStatusToAvailability("FA")).toBe("FREE_AGENT");
    expect(mapNflStatusToAvailability("ACTIVE")).toBe("ACTIVE");
  });

  it("prompt markers for Q/D and OUT", () => {
    expect(availabilityPromptMarker("QUESTIONABLE")).toBe("Questionable");
    expect(availabilityPromptMarker("DOUBTFUL")).toBe("Doubtful");
    expect(availabilityPromptMarker("OUT")).toBe("Out");
    expect(availabilityPromptMarker("ACTIVE")).toBeNull();
  });
});
