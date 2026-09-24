import { describe, expect, it } from "vitest";
import {
  formatInjurySyncOperatorMessage,
  type InjurySyncSummary,
} from "@/lib/nfl/injury-sync";
import {
  mapGameStatusToAvailability,
  nextAvailabilityFromInjuryRow,
} from "@/lib/providers/nfl/nflcom/parse-injuries";

function baseSummary(
  overrides: Partial<InjurySyncSummary> = {},
): InjurySyncSummary {
  return {
    ok: true,
    source: "nfl.com",
    sourceUrl: "https://www.nfl.com/injuries/",
    syncedAt: new Date("2026-09-24T23:00:00.000Z"),
    sourceRowCount: 290,
    officialGameStatusCount: 12,
    blankGameStatusCount: 278,
    matched: 84,
    updated: 0,
    unchanged: 84,
    skippedManual: 0,
    skippedKickoff: 0,
    failed: 0,
    questionable: 0,
    doubtful: 0,
    out: 1,
    unmatched: 3,
    ambiguous: 0,
    errors: [],
    matches: [],
    skippedNonFantasy: 203,
    ...overrides,
  };
}

describe("injury sync coverage summary", () => {
  it("formats operator message with official vs blank Game Status", () => {
    const message = formatInjurySyncOperatorMessage(baseSummary());
    expect(message).toContain("NFL Injury Sync complete ✓");
    expect(message).toContain("290 NFL.com injury-report rows");
    expect(message).toContain("12 official Game Status");
    expect(message).toContain("278 awaiting official Game Status");
    expect(message).toContain("84 matched");
    expect(message).toContain("3 unmatched");
    expect(message).toContain("1 OUT");
    expect(message).toContain("Updated: 0");
  });

  it("does not map practice DNP to OUT", () => {
    expect(mapGameStatusToAvailability("")).toBeNull();
    expect(mapGameStatusToAvailability("Did Not Participate In Practice")).toBeNull();
    expect(
      nextAvailabilityFromInjuryRow({
        gameStatus: null,
        current: "ACTIVE",
      }),
    ).toBeNull();
  });

  it("maps official Out without collapsing unrecognized blanks to UNKNOWN write", () => {
    expect(mapGameStatusToAvailability("Out")).toBe("OUT");
    expect(
      nextAvailabilityFromInjuryRow({
        gameStatus: "OUT",
        current: "ACTIVE",
      }),
    ).toBe("OUT");
  });
});
